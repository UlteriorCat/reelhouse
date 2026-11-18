package com.eclipsia

import com.eclipsia.core.json.text
import com.eclipsia.core.json.objects
import com.eclipsia.core.catalog.EclipsiaTmdb
import com.eclipsia.core.catalog.EclipsiaPosters
import com.eclipsia.core.catalog.EclipsiaParallel

import com.lagradost.cloudstream3.ErrorLoadingException
import com.lagradost.cloudstream3.HomePageResponse
import com.lagradost.cloudstream3.MainAPI
import com.lagradost.cloudstream3.MainPageData
import com.lagradost.cloudstream3.MainPageRequest
import com.lagradost.cloudstream3.SearchResponse
import com.lagradost.cloudstream3.TvType
import com.lagradost.cloudstream3.mainPageOf
import com.lagradost.cloudstream3.newHomePageResponse
import com.lagradost.cloudstream3.newMovieSearchResponse
import com.lagradost.cloudstream3.newTvSeriesSearchResponse
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONArray
import java.net.URLEncoder
import java.util.concurrent.atomic.AtomicReferenceArray

internal object EclipsiaCatalog {
    private const val POSTER_BASE = "https://image.tmdb.org/t/p/w342"
    private const val HOME_URL = "https://www.themoviedb.org"
    private const val MAX_PAGE = 500
    private const val POSTER_BUDGET_MS = 8_000L
    private const val SEARCH_TTL_MS = 5 * 60 * 1000L

    class SearchPage(val items: List<SearchResponse>, val hasNext: Boolean)

    private class Shelf(val title: String, val query: String, val kind: String?)

    internal class Card(
        val id: Int,
        val kind: String,
        val title: String,
        val tmdbCover: String?,
        val imdb: String? = null,
        val target: String? = null,
    )

    internal fun network(id: Int) = "discover/tv?with_networks=$id"

    private val shelves = listOf(
        Shelf("Trending", "trending/all/day", null),
        Shelf("Popular Movies", "trending/movie/week", "movie"),
        Shelf("Popular TV Shows", "trending/tv/week", "tv"),
        Shelf("Netflix", network(213), "tv"),
        Shelf("Disney+", network(2739), "tv"),
        Shelf("Apple TV+", network(2552), "tv"),
        Shelf("HBO", network(49), "tv"),
        Shelf("Paramount+", network(4330), "tv"),
    )

    private val byQuery = shelves.associateBy { it.query }

    val titles: List<String> = shelves.map { it.title }

    fun activeRows(): List<MainPageData> {
        val order = EclipsiaStore.rowOrder("tmdb", titles)
        val on = shelves.sortedBy { order.indexOf(it.title) }
            .filter { EclipsiaStore.catalogRowEnabled(it.title) }
            .filter { EclipsiaStore.catalogSource != EclipsiaStore.SOURCE_NUVIO || EclipsiaNuvioCatalog.hasRow(it.query) }
        return mainPageOf(*on.map { it.query to it.title }.toTypedArray())
    }

    internal fun fingerprint(): String =
        "${EclipsiaStore.catalogSource}|${EclipsiaStore.region}|${EclipsiaStore.language}|${EclipsiaStore.excludedKeywords}|" +
            "${EclipsiaStore.hideLabels}|${EclipsiaPosters.policy().pattern}"

    private fun requestPath(query: String, page: Int): String {
        val sep = if ('?' in query) '&' else '?'
        val excluded = EclipsiaStore.excludedKeywords
        return "$query${sep}region=${EclipsiaStore.region}&language=${EclipsiaStore.language}" +
            (if (excluded.isNotEmpty()) "&without_keywords=$excluded" else "") + "&page=$page"
    }

    suspend fun page(api: MainAPI, page: Int, request: MainPageRequest): HomePageResponse {
        return EclipsiaParallel.page(api, page, request.name, request.data, activeRows(), fingerprint()) { p, name, data ->
            load(api, p, name, data)
        }
    }

    private suspend fun load(api: MainAPI, page: Int, name: String, query: String): HomePageResponse {
        if (EclipsiaStore.catalogSource == EclipsiaStore.SOURCE_NUVIO) return EclipsiaNuvioCatalog.load(api, page, name, query)
        val fallback = byQuery[query]?.kind ?: if ("/movie" in query) "movie" else "tv"
        val root = EclipsiaTmdb.getJson(requestPath(query, page))
            ?: throw ErrorLoadingException("TMDB request failed")
        val results = root.optJSONArray("results") ?: throw ErrorLoadingException("Invalid Json response")
        val totalPages = root.optInt("total_pages", page).coerceAtMost(MAX_PAGE)
        return newHomePageResponse(
            name,
            entries(api, results, fallback, requirePoster = true),
            hasNext = results.length() > 0 && page < totalPages,
        )
    }

    suspend fun search(api: MainAPI, query: String, page: Int): SearchPage {
        val q = query.trim()
        if (q.isEmpty()) return SearchPage(emptyList(), false)
        val p = page.coerceIn(1, MAX_PAGE)
        if (EclipsiaStore.catalogSource == EclipsiaStore.SOURCE_NUVIO) {
            val viaNuvio = runCatching { EclipsiaNuvioCatalog.search(api, q, p) }.getOrNull()
            if (viaNuvio != null && (viaNuvio.items.isNotEmpty() || p > 1)) return viaNuvio
        }
        val enc = URLEncoder.encode(q, "UTF-8").replace("+", "%20")
        val path = "search/multi?query=$enc&include_adult=false&language=${EclipsiaStore.language}&page=$p"
        val root = EclipsiaTmdb.getJson(path, SEARCH_TTL_MS) ?: return SearchPage(emptyList(), false)
        val results = root.optJSONArray("results") ?: return SearchPage(emptyList(), false)
        val totalPages = root.optInt("total_pages", p).coerceAtMost(MAX_PAGE)
        return SearchPage(entries(api, results, "movie", strictKind = true), p < totalPages)
    }

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
