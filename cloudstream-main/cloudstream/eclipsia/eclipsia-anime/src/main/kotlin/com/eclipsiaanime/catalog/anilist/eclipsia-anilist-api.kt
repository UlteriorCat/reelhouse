package com.eclipsiaanime

import com.eclipsia.core.json.text
import com.eclipsia.core.json.objects
import com.eclipsia.core.catalog.EclipsiaParallel

import com.lagradost.cloudstream3.ErrorLoadingException
import com.lagradost.cloudstream3.HomePageResponse
import com.lagradost.cloudstream3.MainAPI
import com.lagradost.cloudstream3.MainPageData
import com.lagradost.cloudstream3.MainPageRequest
import com.lagradost.cloudstream3.SearchResponse
import com.lagradost.cloudstream3.SearchResponseList
import com.lagradost.cloudstream3.mainPageOf
import com.lagradost.cloudstream3.newHomePageResponse
import com.lagradost.cloudstream3.newSearchResponseList
import org.json.JSONObject

internal object EclipsiaAnilistApi {
    const val PREFIX = "anilist:"
    private const val PER_PAGE = 20
    private const val KEY = "anilist"
    private const val MAPPINGS_TAIL =
        "&include=item.mappings&fields%5Bmappings%5D=externalSite,externalId&fields%5Banime%5D=mappings"

    private class Shelf(val key: String, val query: String) {
        val label = key.removePrefix("AniList ")
    }

    private class Item(
        val id: Int,
        val malId: Int,
        val titles: List<String>,
        val title: String,
        val isMovie: Boolean,
        val year: Int?,
        val poster: String?,
    )

    private val shelves = listOf(
        Shelf("AniList Top Anime", "${PREFIX}top"),
        Shelf("AniList Airing Now", "${PREFIX}airing"),
        Shelf("AniList Most Popular", "${PREFIX}popular"),
        Shelf("AniList Upcoming", "${PREFIX}upcoming"),
        Shelf("AniList Top Anime Movies", "${PREFIX}movies"),
        Shelf("AniList This Season", "${PREFIX}season"),
    )

    val titles: List<String> = shelves.map { it.key }
    val labels: List<String> = shelves.map { it.label }

    fun activeRows(): List<MainPageData> {
        val order = EclipsiaStore.rowOrder(KEY, titles)
        val on = shelves.sortedBy { order.indexOf(it.key) }
            .filter { EclipsiaStore.catalogRowEnabled(it.key) }
        return mainPageOf(*on.map { it.query to it.label }.toTypedArray())
    }

    private fun args(key: String): String = when (key) {
        "airing" -> "status: RELEASING, sort: POPULARITY_DESC"
        "popular" -> "sort: POPULARITY_DESC"
        "upcoming" -> "status: NOT_YET_RELEASED, sort: POPULARITY_DESC"
        "movies" -> "format: MOVIE, sort: SCORE_DESC"
        "season" -> {
            val (season, year) = currentAnimeSeason()
            "season: $season, seasonYear: $year, sort: POPULARITY_DESC"
        }
        else -> "sort: SCORE_DESC"
    }

    private fun selection(alias: String, key: String) =
        "$alias: Page(page: \$p, perPage: $PER_PAGE) { pageInfo { hasNextPage } " +
            "media(type: ANIME, isAdult: false, ${args(key)}) { ...L } }"

    private fun known(key: String) = shelves.any { it.query == "$PREFIX$key" }

    private suspend fun row(key: String, page: Int): JSONObject? {
        val keys = activeRows().map { it.data.removePrefix(PREFIX) }
        val vars = JSONObject().put("p", page)
        if (page == 1 && key in keys && keys.size > 1) {
            val body = keys.joinToString(" ") { selection("r_$it", it) }
            EclipsiaAnilistMeta.query(
                "query(\$p: Int) { $body } ${EclipsiaAnilistMeta.LIST_FRAGMENT}", vars, EclipsiaAnilistMeta.LIST_TTL_MS,
            )?.optJSONObject("r_$key")?.let { return it }
        }
        return EclipsiaAnilistMeta.query(
            "query(\$p: Int) { ${selection("r", key)} } ${EclipsiaAnilistMeta.LIST_FRAGMENT}", vars, EclipsiaAnilistMeta.LIST_TTL_MS,
        )?.optJSONObject("r")
    }

    private fun parse(media: org.json.JSONArray?): List<Item> {
        val seen = HashSet<Int>()
        val out = ArrayList<Item>()
        for (o in media.objects()) {
            val id = o.optInt("id").takeIf { it > 0 } ?: continue
            if (!seen.add(id)) continue
            val names = EclipsiaAnilistMeta.titlesOf(o)
            if (names.isEmpty()) continue
            val t = o.optJSONObject("title")
            val c = o.optJSONObject("coverImage")
            out += Item(
                id, o.optInt("idMal", 0), names,
                t?.text("english") ?: t?.text("romaji") ?: names.first(),
                o.text("format").equals("MOVIE", true),
                EclipsiaAnilistMeta.yearOf(o),
                (c?.text("extraLarge") ?: c?.text("large"))?.takeIf { it.startsWith("https://", ignoreCase = true) },
            )
        }
        return out
    }

    private suspend fun tvdbVia(site: String, external: Int): String? {
        val root = EclipsiaKitsuMeta.get(
            "mappings?filter%5BexternalSite%5D=$site&filter%5BexternalId%5D=$external$MAPPINGS_TAIL",
        ) ?: return null
        val included = root.optJSONArray("included").objects()
        val pairs = included.filter { it.optString("type") == "mappings" }.mapNotNull {
            val at = it.optJSONObject("attributes") ?: return@mapNotNull null
            (at.text("externalSite") ?: return@mapNotNull null) to (at.text("externalId") ?: return@mapNotNull null)
        }
        EclipsiaAnimeMatcher.tvdbOf(pairs)?.let { return it }
        if (pairs.isNotEmpty()) return null
        val kitsuId = included.firstOrNull { it.optString("type") == "anime" }?.text("id") ?: return null
        return EclipsiaKitsuApi.tvdbOf(kitsuId)
    }

    private suspend fun tvdbOf(item: Item): String? =
        tvdbVia("anilist/anime", item.id) ?: if (item.malId > 0) tvdbVia("myanimelist/anime", item.malId) else null

    private suspend fun cards(api: MainAPI, page: JSONObject?): AnimeListing? {
        page ?: return null
        val items = parse(page.optJSONArray("media"))
        val built = EclipsiaAnimeCards.build(items) { item ->
            val match = EclipsiaAnimeMatcher.resolve("a:${item.id}:${item.isMovie}", item.isMovie, item.titles, item.year) {
                tvdbOf(item)
            } ?: return@build null
            EclipsiaAnimeCards.card(api, match, item.title, item.poster)
        }
        val more = page.optJSONObject("pageInfo")?.optBoolean("hasNextPage", false) == true
        return AnimeListing(built, more)
    }

    suspend fun page(api: MainAPI, page: Int, request: MainPageRequest): HomePageResponse =
        EclipsiaParallel.page(api, page, request.name, request.data, activeRows(), EclipsiaCatalog.fingerprint()) { p, name, data ->
            val key = data.removePrefix(PREFIX)
            val listing = if (known(key)) cards(api, row(key, p.coerceAtLeast(1))) else null
            listing ?: throw ErrorLoadingException("AniList request failed")
            newHomePageResponse(name, listing.items, hasNext = listing.hasNext)
        }

    private suspend fun lookup(api: MainAPI, query: String, page: Int): AnimeListing? {
        val q = query.trim()
        if (q.isEmpty()) return null
        val gql = "query(\$s: String, \$p: Int) { Page(page: \$p, perPage: $PER_PAGE) { pageInfo { hasNextPage } " +
            "media(search: \$s, type: ANIME, sort: SEARCH_MATCH) { ...L } } } ${EclipsiaAnilistMeta.LIST_FRAGMENT}"
        val data = EclipsiaAnilistMeta.query(
            gql, JSONObject().put("s", q).put("p", page.coerceAtLeast(1)), 5 * 60 * 1000L,
        )?.optJSONObject("Page")
        return cards(api, data)
    }

    suspend fun searchItems(api: MainAPI, query: String): List<SearchResponse> =
        lookup(api, query, 1)?.items.orEmpty()

    suspend fun search(api: MainAPI, query: String, page: Int = 1): SearchResponseList {
        val listing = lookup(api, query, page)
        return newSearchResponseList(listing?.items.orEmpty(), hasNext = listing?.hasNext == true)
    }
}
