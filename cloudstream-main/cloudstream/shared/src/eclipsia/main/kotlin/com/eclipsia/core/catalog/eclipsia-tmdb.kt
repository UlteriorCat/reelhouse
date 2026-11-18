package com.eclipsia.core.catalog

import com.eclipsia.core.net.FetchTuning
import com.eclipsia.core.net.RawResponse
import com.eclipsia.core.net.textFetcher
import com.eclipsia.core.store.StoreContract
import com.lagradost.cloudstream3.app
import org.json.JSONObject

internal object EclipsiaTmdb {
    private lateinit var store: StoreContract

    fun init(store: StoreContract) {
        this.store = store
    }

    const val BASE = "https://api.themoviedb.org/3"
    const val TTL_MS = 10 * 60 * 1000L
    const val TTL_LONG_MS = 6 * 60 * 60 * 1000L

    private const val LANE_API = "tmdb"
    private const val LANE_EXTERNAL = "external"

    private val fetcher = textFetcher(
        FetchTuning(
            parallel = 10,
            maxEntries = 300,
            attemptTimeoutMs = 7_000L,
            attempts = 3,
            backoffMs = 250L,
            maxRetryAfterMs = 3_000L,
            breakerThreshold = 4,
            breakerOpenMs = 12_000L,
            maxWeight = 3_000_000L,
            backgroundParallel = 8,
        ),
    )

    suspend fun get(path: String, ttlMs: Long = TTL_MS, attempts: Int = 3, background: Boolean = false): String? {
        val external = path.startsWith("https://") || path.startsWith("http://")
        return fetcher.get(path, ttlMs, if (external) LANE_EXTERNAL else LANE_API, attempts, background = background) {
            val url = if (external) path else "$BASE/$path${if ('?' in path) '&' else '?'}api_key=${store.tmdbKey()}"
            val resp = app.get(url)
            RawResponse(resp.code, if (resp.code in 200..299) resp.text else null, resp.headers["Retry-After"])
        }
    }

    suspend fun getJson(path: String, ttlMs: Long = TTL_MS, attempts: Int = 3, background: Boolean = false): JSONObject? =
        get(path, ttlMs, attempts, background)?.let { runCatching { JSONObject(it) }.getOrNull() }
}
