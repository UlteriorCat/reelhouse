package com.eclipsia.core.catalog

import com.eclipsia.core.json.text
import com.eclipsia.core.store.DiskCache
import com.eclipsia.core.store.StoreContract
import kotlinx.coroutines.withTimeoutOrNull

internal object EclipsiaPosters {
    private const val HIDDEN_TITLE = "\u200B"
    private const val IMDB_WAIT_MS = 2_500L
    private const val IMDB_HIT_TTL_MS = 24 * 60 * 60 * 1000L
    private const val IMDB_MISS_TTL_MS = 30 * 60 * 1000L
    private const val IMDB_MAX_ENTRIES = 2_000

    class Policy(val pattern: String?) {
        val active: Boolean get() = pattern != null
        val needsImdb: Boolean get() = pattern?.contains("{imdb_id}") == true
    }

    private class Known(val id: String?, val at: Long)

    private lateinit var store: StoreContract
    private lateinit var diskName: String

    fun init(store: StoreContract, prefsName: String) {
        this.store = store
        diskName = prefsName
    }

    private const val STORE_MAX = 6_000

    private val disk by lazy {
        DiskCache({ store.context.getSharedPreferences(diskName, android.content.Context.MODE_PRIVATE) }, STORE_MAX)
    }

    private fun persisted(key: String): String? = disk.get(key)?.takeIf { it.startsWith("tt") }

    private fun persist(key: String, imdb: String) = disk.put(key, imdb)

    private val imdbIds = object : LinkedHashMap<String, Known>(64, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Known>?): Boolean =
            size > IMDB_MAX_ENTRIES
    }

    fun cardLabel(title: String): String {
        val hide = store.hideLabels
        return if (hide) HIDDEN_TITLE else title
    }

    fun policy(): Policy {
        val on = store.customPosterEnabled
        if (!on) return Policy(null)
        val pattern = store.customPosterTemplate
            .replace("%7B", "{", ignoreCase = true).replace("%7D", "}", ignoreCase = true)
            .takeIf { it.startsWith("https://", ignoreCase = true) }
        return Policy(pattern)
    }

    private fun typeOf(kind: String) = if (kind == "tv") "series" else "movie"

    private fun lookup(key: String): Known? {
        val known = synchronized(imdbIds) { imdbIds[key] } ?: return null
        val ttl = if (known.id == null) IMDB_MISS_TTL_MS else IMDB_HIT_TTL_MS
        return known.takeIf { System.currentTimeMillis() - it.at < ttl }
    }

    fun cachedImdb(kind: String, tmdbId: Int): String? {
        val key = "$kind:$tmdbId"
        lookup(key)?.let { return it.id }
        val saved = persisted(key) ?: return null
        synchronized(imdbIds) { imdbIds[key] = Known(saved, System.currentTimeMillis()) }
        return saved
    }

    private suspend fun imdbOf(kind: String, tmdbId: Int): String? {
        val key = "$kind:$tmdbId"
        cachedImdb(kind, tmdbId)?.let { return it }
        lookup(key)?.let { return it.id }
        val found = EclipsiaTmdb.getJson("$kind/$tmdbId/external_ids", EclipsiaTmdb.TTL_LONG_MS, background = true)
            ?.text("imdb_id")?.takeIf { it.startsWith("tt") }
        synchronized(imdbIds) { imdbIds[key] = Known(found, System.currentTimeMillis()) }
        if (found != null) persist(key, found)
        return found
    }

    fun remember(kind: String, tmdbId: Int, imdbId: String?) {
        val id = imdbId?.takeIf { it.startsWith("tt") } ?: return
        val key = "$kind:$tmdbId"
        if (cachedImdb(kind, tmdbId) == id) return
        synchronized(imdbIds) { imdbIds[key] = Known(id, System.currentTimeMillis()) }
        persist(key, id)
    }

    fun resolveImdb(kind: String, imdbId: String, fallback: String?): String? {
        val pattern = policy().pattern ?: return fallback
        if ("{tmdb_id}" in pattern) return fallback
        return pattern
            .replace("{imdb_id}", imdbId)
            .replace("{type}", if (kind == "series") "series" else "movie")
    }

    fun resolveLocal(policy: Policy, kind: String, tmdbId: Int, fallback: String?): String? {
        val pattern = policy.pattern ?: return fallback
        if (tmdbId <= 0 && "{tmdb_id}" in pattern) return fallback
        return pattern.replace("{tmdb_id}", tmdbId.toString()).replace("{type}", typeOf(kind))
    }

    suspend fun resolve(
        kind: String,
        tmdbId: Int,
        imdbId: String?,
        fallback: String?,
        policy: Policy = policy(),
        waitMs: Long = IMDB_WAIT_MS,
    ): String? {
        val pattern = policy.pattern ?: return fallback
        if (tmdbId <= 0 && "{tmdb_id}" in pattern) return fallback
        var url = pattern
        if (policy.needsImdb) {
            val imdb = imdbId?.takeIf { it.startsWith("tt") }
                ?: (if (tmdbId <= 0) return fallback else null)
                ?: cachedImdb(kind, tmdbId)
                ?: (if (waitMs > 0) withTimeoutOrNull(waitMs) { imdbOf(kind, tmdbId) } else imdbOf(kind, tmdbId))
                ?: return fallback
            url = url.replace("{imdb_id}", imdb)
        }
        return url
            .replace("{tmdb_id}", tmdbId.toString())
            .replace("{type}", typeOf(kind))
    }
}
