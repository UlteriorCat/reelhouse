package com.eclipsiabdix

import com.lagradost.cloudstream3.app
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap

internal object EclipsiaTmdbLookup {
    class Resolved(val tmdbId: Int, val isTv: Boolean, val season: Int?, val episode: Int?)

    private const val BASE = "https://api.themoviedb.org/3"
    private const val TIMEOUT_MS = 8_000L
    private const val ATTEMPTS = 3
    private const val MAX_ENTRIES = 300

    private val cache = ConcurrentHashMap<String, JSONObject>()

    private suspend fun find(imdb: String): JSONObject? {
        cache[imdb]?.let { return it }
        repeat(ATTEMPTS) { attempt ->
            try {
                val resp = app.get(
                    "$BASE/find/$imdb?external_source=imdb_id&api_key=${EclipsiaStore.tmdbKey()}",
                    timeout = TIMEOUT_MS,
                )
                if (resp.code in 200..299) {
                    val parsed = runCatching { JSONObject(resp.text) }.getOrNull()
                    if (parsed != null) {
                        if (cache.size >= MAX_ENTRIES) cache.clear()
                        cache[imdb] = parsed
                        return parsed
                    }
                } else if (resp.code == 404 || resp.code == 401) {
                    return null
                }
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
            }
            if (attempt < ATTEMPTS - 1) delay(250L * (attempt + 1))
        }
        return null
    }

    suspend fun resolve(imdb: String, season: Int?, episode: Int?, tvHint: Boolean): Resolved? {
        val root = find(imdb) ?: return null
        fun first(key: String): JSONObject? = root.optJSONArray(key)?.optJSONObject(0)

        first("tv_episode_results")?.let { ep ->
            val show = ep.optInt("show_id", 0)
            if (show > 0) {
                return Resolved(
                    show,
                    true,
                    season ?: ep.optInt("season_number", -1).takeIf { it >= 0 },
                    episode ?: ep.optInt("episode_number", -1).takeIf { it >= 0 },
                )
            }
        }
        val order = if (tvHint) listOf("tv_results" to true, "movie_results" to false)
        else listOf("movie_results" to false, "tv_results" to true)
        for ((key, tv) in order) {
            val id = first(key)?.optInt("id", 0) ?: 0
            if (id > 0) return Resolved(id, tv, season, episode)
        }
        return null
    }
}
