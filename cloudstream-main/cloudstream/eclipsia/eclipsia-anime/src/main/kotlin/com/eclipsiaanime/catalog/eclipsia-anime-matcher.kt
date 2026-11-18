package com.eclipsiaanime

import com.eclipsia.core.json.text
import com.eclipsia.core.json.objects
import com.eclipsia.core.catalog.EclipsiaTmdb
import com.eclipsia.core.store.DiskCache
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import java.net.URLEncoder
import java.util.concurrent.ConcurrentHashMap

internal class AnimeMatch(val kind: String, val id: Int, val poster: String?)

internal object EclipsiaAnimeMatcher {
    const val HOME_URL = "https://www.themoviedb.org"

    private const val POSTER_BASE = "https://image.tmdb.org/t/p/w500"
    private const val STORE = "eclipsia_anime_matches"
    private const val STORE_MAX = 5_000
    private const val MISS_TTL_MS = 10 * 60 * 1000L
    private const val MISS_MAX = 1_000
    private const val FIND_TTL_MS = 24 * 60 * 60 * 1000L
    private const val SEARCH_TTL_MS = 6 * 60 * 60 * 1000L
    private const val MAX_TITLES = 4
    private const val MAX_CANDIDATES = 8

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val known = ConcurrentHashMap<String, AnimeMatch>()
    private val misses = ConcurrentHashMap<String, Long>()
    private val inflight = ConcurrentHashMap<String, Deferred<AnimeMatch?>>()

    private val disk by lazy {
        DiskCache({ EclipsiaStore.context.getSharedPreferences(STORE, android.content.Context.MODE_PRIVATE) }, STORE_MAX)
    }

    private val seasonSuffix =
        Regex("""(?i)\s*[:\-]?\s*(\d+(st|nd|rd|th)\s+season|season\s*\d+|part\s*\d+|cour\s*\d+|final season)\b.*$""")

    private fun baseTitle(t: String) = t.replace(seasonSuffix, "").trim()

    private fun recall(key: String): AnimeMatch? {
        known[key]?.let { return it }
        val raw = disk.get(key) ?: return null
        val kind = raw.substringBefore(':')
        val id = raw.substringAfter(':', "").toIntOrNull()?.takeIf { it > 0 } ?: return null
        if (kind != "tv" && kind != "movie") return null
        return AnimeMatch(kind, id, null).also { known[key] = it }
    }

    private fun remember(key: String, match: AnimeMatch) {
        known[key] = match
        disk.put(key, "${match.kind}:${match.id}")
    }

    private fun missed(key: String): Boolean {
        val at = misses[key] ?: return false
        if (System.currentTimeMillis() - at < MISS_TTL_MS) return true
        misses.remove(key, at)
        return false
    }

    private fun markMiss(key: String) {
        if (misses.size >= MISS_MAX) misses.clear()
        misses[key] = System.currentTimeMillis()
    }

    fun cached(key: String): AnimeMatch? = recall(key)

    suspend fun resolve(
        key: String,
        isMovie: Boolean,
        titles: List<String>,
        year: Int?,
        tvdbId: suspend () -> String?,
    ): AnimeMatch? {
        recall(key)?.let { return it }
        if (missed(key)) return null
        val job = inflight.computeIfAbsent(key) { k ->
            scope.async(start = CoroutineStart.LAZY) {
                try {
                    val found = (if (isMovie) null else tvdbId()?.let { viaTvdb(it) }) ?: byTitle(titles, isMovie, year)
                    if (found != null) remember(k, found) else markMiss(k)
                    found
                } finally {
                    inflight.remove(k)
                }
            }
        }
        return job.await()
    }

    private fun posterOf(hit: org.json.JSONObject): String? =
        hit.text("poster_path")?.takeIf { it.startsWith("/") }?.let { POSTER_BASE + it }

    private suspend fun viaTvdb(tvdb: String): AnimeMatch? {
        if (tvdb.isEmpty() || !tvdb.all(Char::isDigit)) return null
        val root = EclipsiaTmdb.getJson("find/$tvdb?external_source=tvdb_id", FIND_TTL_MS) ?: return null
        val hit = root.optJSONArray("tv_results").objects().firstOrNull() ?: return null
        val id = hit.optInt("id", 0).takeIf { it > 0 } ?: return null
        return AnimeMatch("tv", id, posterOf(hit))
    }

    private suspend fun byTitle(titles: List<String>, isMovie: Boolean, year: Int?): AnimeMatch? {
        val kind = if (isMovie) "movie" else "tv"
        val wanted = (titles + titles.map(::baseTitle)).map(::normTitle).filter { it.isNotEmpty() }.toSet()
        if (wanted.isEmpty()) return null
        val language = EclipsiaStore.language
        for (title in (titles.map(::baseTitle) + titles).filter { it.isNotBlank() }.distinct().take(MAX_TITLES)) {
            val q = URLEncoder.encode(title, "UTF-8")
            val root = EclipsiaTmdb.getJson(
                "search/$kind?query=$q&include_adult=false&language=$language", SEARCH_TTL_MS,
            ) ?: continue
            val list = root.optJSONArray("results").objects().take(MAX_CANDIDATES)
            val animated = list.filter { o ->
                val genres = o.optJSONArray("genre_ids")
                genres != null && (0 until genres.length()).any { genres.optInt(it) == 16 }
            }
            fun yearOk(o: org.json.JSONObject): Boolean {
                if (!isMovie || year == null) return true
                val y = (o.text("release_date") ?: "").take(4).toIntOrNull() ?: return true
                return kotlin.math.abs(y - year) <= 1
            }
            fun named(o: org.json.JSONObject) =
                NAME_KEYS.any { normTitle(o.text(it)) in wanted }
            val hit = animated.firstOrNull { named(it) && yearOk(it) }
                ?: animated.firstOrNull { yearOk(it) && it.text("original_language") == "ja" }
                ?: continue
            val id = hit.optInt("id", 0).takeIf { it > 0 } ?: continue
            return AnimeMatch(kind, id, posterOf(hit))
        }
        return null
    }

    private val NAME_KEYS = listOf("name", "original_name", "title", "original_title")

    fun tvdbOf(mappings: List<Pair<String, String>>): String? {
        var season: String? = null
        for ((site, ext) in mappings) {
            when (site) {
                "thetvdb/series", "thetvdb" -> return ext.substringBefore('/')
                "thetvdb/season" -> if ('/' in ext && season == null) season = ext.substringBefore('/')
            }
        }
        return season
    }
}
