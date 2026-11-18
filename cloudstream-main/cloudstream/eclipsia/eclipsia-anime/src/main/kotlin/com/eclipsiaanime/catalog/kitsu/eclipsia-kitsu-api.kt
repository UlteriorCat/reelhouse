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

internal object EclipsiaKitsuApi {
    const val PREFIX = "kitsu:"
    private const val PER_PAGE = 20
    private const val KEY = "kitsu"
    private const val ATTRS = "canonicalTitle,titles,subtype,startDate,posterImage,mappings"
    private const val LIST_QUERY =
        "fields%5Banime%5D=$ATTRS&include=mappings&fields%5Bmappings%5D=externalSite,externalId"

    private class Shelf(val key: String, val query: String) {
        val label = key.removePrefix("Kitsu ")
    }

    private class Item(
        val id: String,
        val titles: List<String>,
        val isMovie: Boolean,
        val year: Int?,
        val poster: String?,
        val tvdb: String?,
        val linked: Boolean,
    )

    private val shelves = listOf(
        Shelf("Kitsu Top Anime", "${PREFIX}top"),
        Shelf("Kitsu Airing Now", "${PREFIX}airing"),
        Shelf("Kitsu Most Popular", "${PREFIX}popular"),
        Shelf("Kitsu Upcoming", "${PREFIX}upcoming"),
        Shelf("Kitsu Top Anime Movies", "${PREFIX}movies"),
        Shelf("Kitsu This Season", "${PREFIX}season"),
    )

    val titles: List<String> = shelves.map { it.key }
    val labels: List<String> = shelves.map { it.label }

    fun activeRows(): List<MainPageData> {
        val order = EclipsiaStore.rowOrder(KEY, titles)
        val on = shelves.sortedBy { order.indexOf(it.key) }
            .filter { EclipsiaStore.catalogRowEnabled(it.key) }
        return mainPageOf(*on.map { it.query to it.label }.toTypedArray())
    }

    private fun filter(key: String): String = when (key) {
        "airing" -> "filter%5Bstatus%5D=current&sort=popularityRank"
        "popular" -> "sort=popularityRank"
        "upcoming" -> "filter%5Bstatus%5D=upcoming&sort=popularityRank"
        "movies" -> "filter%5Bsubtype%5D=movie&sort=ratingRank"
        "season" -> {
            val (season, year) = currentAnimeSeason()
            "filter%5Bseason%5D=${season.lowercase()}&filter%5BseasonYear%5D=$year&sort=popularityRank"
        }
        else -> "sort=ratingRank"
    }

    private fun parse(root: JSONObject): List<Item> {
        val mappings = HashMap<String, Pair<String, String>>()
        for (o in root.optJSONArray("included").objects()) {
            if (o.optString("type") != "mappings") continue
            val at = o.optJSONObject("attributes") ?: continue
            val id = o.text("id") ?: continue
            mappings[id] = (at.text("externalSite") ?: continue) to (at.text("externalId") ?: continue)
        }
        val seen = HashSet<String>()
        val out = ArrayList<Item>()
        for (o in root.optJSONArray("data").objects()) {
            val id = o.text("id") ?: continue
            if (!seen.add(id)) continue
            val at = o.optJSONObject("attributes") ?: continue
            val t = at.optJSONObject("titles")
            val names = listOfNotNull(t?.text("en") ?: t?.text("en_us"), t?.text("en_jp") ?: at.text("canonicalTitle")).distinct()
            if (names.isEmpty()) continue
            val linkage = o.optJSONObject("relationships")?.optJSONObject("mappings")?.optJSONArray("data")
            val pairs = linkage.objects().mapNotNull { mappings[it.optString("id")] }
            val poster = at.optJSONObject("posterImage")
            out += Item(
                id, names,
                at.text("subtype").equals("movie", true),
                at.text("startDate")?.take(4)?.toIntOrNull(),
                (poster?.text("large") ?: poster?.text("original"))?.takeIf { it.startsWith("https://", ignoreCase = true) },
                EclipsiaAnimeMatcher.tvdbOf(pairs),
                linkage != null && mappings.isNotEmpty(),
            )
        }
        return out
    }

    suspend fun tvdbOf(id: String): String? {
        val root = EclipsiaKitsuMeta.get("anime/$id/mappings?page%5Blimit%5D=20") ?: return null
        val pairs = root.optJSONArray("data").objects().mapNotNull {
            val at = it.optJSONObject("attributes") ?: return@mapNotNull null
            (at.text("externalSite") ?: return@mapNotNull null) to (at.text("externalId") ?: return@mapNotNull null)
        }
        return EclipsiaAnimeMatcher.tvdbOf(pairs)
    }

    private suspend fun cards(api: MainAPI, root: JSONObject): AnimeListing {
        val items = parse(root)
        val built = EclipsiaAnimeCards.build(items) { item ->
            val match = EclipsiaAnimeMatcher.resolve("k:${item.id}:${item.isMovie}", item.isMovie, item.titles, item.year) {
                item.tvdb ?: if (item.linked) null else tvdbOf(item.id)
            } ?: return@build null
            EclipsiaAnimeCards.card(api, match, item.titles.first(), item.poster)
        }
        val more = root.optJSONObject("links")?.has("next") == true
        return AnimeListing(built, more && items.isNotEmpty())
    }

    private suspend fun fetch(api: MainAPI, query: String, page: Int): AnimeListing? {
        val offset = (page.coerceAtLeast(1) - 1) * PER_PAGE
        val root = EclipsiaKitsuMeta.get(
            "anime?$query&$LIST_QUERY&page%5Blimit%5D=$PER_PAGE&page%5Boffset%5D=$offset",
            EclipsiaKitsuMeta.LIST_TTL_MS,
        ) ?: return null
        return cards(api, root)
    }

    suspend fun page(api: MainAPI, page: Int, request: MainPageRequest): HomePageResponse =
        EclipsiaParallel.page(api, page, request.name, request.data, activeRows(), EclipsiaCatalog.fingerprint()) { p, name, data ->
            val listing = fetch(api, filter(data.removePrefix(PREFIX)), p)
                ?: throw ErrorLoadingException("Kitsu request failed")
            newHomePageResponse(name, listing.items, hasNext = listing.hasNext)
        }

    private suspend fun lookup(api: MainAPI, query: String, page: Int): AnimeListing? {
        val q = query.trim()
        if (q.isEmpty()) return null
        return fetch(api, "filter%5Btext%5D=${EclipsiaKitsuMeta.enc(q)}", page)
    }

    suspend fun searchItems(api: MainAPI, query: String): List<SearchResponse> =
        lookup(api, query, 1)?.items.orEmpty()

    suspend fun search(api: MainAPI, query: String, page: Int = 1): SearchResponseList {
        val listing = lookup(api, query, page)
        return newSearchResponseList(listing?.items.orEmpty(), hasNext = listing?.hasNext == true)
    }
}
