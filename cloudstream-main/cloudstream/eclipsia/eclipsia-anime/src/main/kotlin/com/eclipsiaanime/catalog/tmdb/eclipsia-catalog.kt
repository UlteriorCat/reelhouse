package com.eclipsiaanime

import com.eclipsia.core.json.text
import com.eclipsia.core.json.objects
import com.eclipsia.core.catalog.EclipsiaPosters
import com.lagradost.cloudstream3.MainAPI
import com.lagradost.cloudstream3.SearchResponse
import com.lagradost.cloudstream3.TvType
import com.lagradost.cloudstream3.newMovieSearchResponse
import com.lagradost.cloudstream3.newTvSeriesSearchResponse
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONArray
import java.util.concurrent.atomic.AtomicReferenceArray

internal object EclipsiaCatalog {
    private const val POSTER_BASE = "https://image.tmdb.org/t/p/w342"
    private const val HOME_URL = "https://www.themoviedb.org"
    private const val POSTER_BUDGET_MS = 8_000L

    internal class Card(
        val id: Int,
        val kind: String,
        val title: String,
        val tmdbCover: String?,
        val imdb: String? = null,
        val target: String? = null,
    )

    internal fun fingerprint(): String =
        "${EclipsiaStore.language}|${EclipsiaStore.hideLabels}|${EclipsiaPosters.policy().pattern}"

    private fun parse(array: JSONArray, fallback: String, strictKind: Boolean, requirePoster: Boolean): List<Card> {
        val seen = HashSet<String>(array.length() * 2)
        val out = ArrayList<Card>(array.length())
        for (item in array.objects()) {
            val id = item.optInt("id").takeIf { it > 0 } ?: continue
            val declared = item.optString("media_type")
            val kind = when {
                declared == "movie" || declared == "tv" -> declared
                strictKind -> continue
                else -> fallback
            }
            if (!seen.add("$kind:$id")) continue
            val title = sequenceOf("title", "name", "original_title", "original_name")
                .mapNotNull { item.text(it) }.firstOrNull() ?: continue
            val cover = item.text("poster_path")?.takeIf { it.startsWith("/") }?.let { POSTER_BASE + it }
            if (requirePoster && cover == null) continue
            out += Card(id, kind, title, cover)
        }
        return out
    }

    private suspend fun covers(policy: EclipsiaPosters.Policy, cards: List<Card>): List<String?> {
        if (!policy.active) return cards.map { it.tmdbCover }
        if (!policy.needsImdb) {
            return cards.map { EclipsiaPosters.resolveLocal(policy, it.kind, it.id, it.tmdbCover) }
        }
        val resolved = AtomicReferenceArray<String?>(cards.size)
        withTimeoutOrNull(POSTER_BUDGET_MS) {
            coroutineScope {
                cards.forEachIndexed { i, c ->
                    launch { resolved.set(i, EclipsiaPosters.resolve(c.kind, c.id, c.imdb, c.tmdbCover, policy, waitMs = 0)) }
                }
            }
        }
        return cards.mapIndexed { i, c -> resolved.get(i) ?: c.tmdbCover }
    }

    suspend fun entries(
        api: MainAPI,
        array: JSONArray?,
        fallback: String,
        strictKind: Boolean = false,
        requirePoster: Boolean = false,
    ): List<SearchResponse> {
        if (array == null || array.length() == 0) return emptyList()
        return render(api, parse(array, fallback, strictKind, requirePoster))
    }

    internal suspend fun render(api: MainAPI, cards: List<Card>): List<SearchResponse> {
        if (cards.isEmpty()) return emptyList()
        val posters = covers(EclipsiaPosters.policy(), cards)
        return cards.mapIndexed { i, c ->
            val label = EclipsiaPosters.cardLabel(c.title)
            val target = c.target ?: "$HOME_URL/${c.kind}/${c.id}"
            val cover = posters[i]
            if (c.kind == "movie") api.newMovieSearchResponse(label, target, TvType.Movie) { posterUrl = cover }
            else api.newTvSeriesSearchResponse(label, target, TvType.TvSeries) { posterUrl = cover }
        }
    }
}
