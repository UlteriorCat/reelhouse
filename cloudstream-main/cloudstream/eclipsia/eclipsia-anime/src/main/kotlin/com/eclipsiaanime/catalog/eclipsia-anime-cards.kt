package com.eclipsiaanime

import com.eclipsia.core.catalog.EclipsiaPosters
import com.lagradost.cloudstream3.MainAPI
import com.lagradost.cloudstream3.SearchResponse
import com.lagradost.cloudstream3.TvType
import com.lagradost.cloudstream3.newMovieSearchResponse
import com.lagradost.cloudstream3.newTvSeriesSearchResponse
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withTimeoutOrNull

internal class AnimeListing(val items: List<SearchResponse>, val hasNext: Boolean)

internal object EclipsiaAnimeCards {
    private const val BUDGET_MS = 7_000L

    suspend fun <T> build(items: List<T>, block: suspend (T) -> SearchResponse?): List<SearchResponse> = coroutineScope {
        val deadline = System.currentTimeMillis() + BUDGET_MS
        items.map { item ->
            async {
                withTimeoutOrNull((deadline - System.currentTimeMillis()).coerceAtLeast(1L)) { block(item) }
            }
        }.awaitAll().filterNotNull().distinctBy { it.url }
    }

    suspend fun card(api: MainAPI, match: AnimeMatch, title: String, poster: String?): SearchResponse {
        val cover = EclipsiaPosters.resolve(match.kind, match.id, null, poster ?: match.poster)
        val label = EclipsiaPosters.cardLabel(title)
        val target = "${EclipsiaAnimeMatcher.HOME_URL}/${match.kind}/${match.id}"
        return if (match.kind == "movie") api.newMovieSearchResponse(label, target, TvType.Movie) { posterUrl = cover }
        else api.newTvSeriesSearchResponse(label, target, TvType.TvSeries) { posterUrl = cover }
    }
}
