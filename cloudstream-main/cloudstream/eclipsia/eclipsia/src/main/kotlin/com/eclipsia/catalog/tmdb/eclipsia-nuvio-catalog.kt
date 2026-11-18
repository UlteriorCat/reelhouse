package com.eclipsia

import com.eclipsia.core.json.text
import com.eclipsia.core.json.objects
import com.eclipsia.core.catalog.EclipsiaTmdb
import com.lagradost.cloudstream3.ErrorLoadingException
import com.lagradost.cloudstream3.HomePageResponse
import com.lagradost.cloudstream3.MainAPI
import com.lagradost.cloudstream3.newHomePageResponse
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import org.json.JSONObject
import java.net.URLEncoder
import java.util.concurrent.ConcurrentHashMap

internal object EclipsiaNuvioCatalog {
    private const val BASE = "https://catalog.nuvio.tv"
    private const val HOME_URL = "https://www.themoviedb.org"
    private const val TTL_MS = 30 * 60 * 1000L
    private const val DEFAULT_PAGE_SIZE = 20

    private class Source(val kind: String, val id: String)

    private val sources: Map<String, List<Source>> = mapOf(
        "trending/all/day" to listOf(Source("movie", "trending-movies"), Source("series", "trending-series")),
        "trending/movie/week" to listOf(Source("movie", "trending-movies")),
        "trending/tv/week" to listOf(Source("series", "trending-series")),
        EclipsiaCatalog.network(213) to listOf(Source("series", "netflix-series")),
        EclipsiaCatalog.network(2739) to listOf(Source("series", "disney-plus-series")),
    )

    private val pageSizes = ConcurrentHashMap<String, Int>()

    fun hasRow(query: String): Boolean = query in sources

    private fun base(): String {
        val language = EclipsiaStore.language
        val region = EclipsiaStore.region
        if (language == EclipsiaStore.DEFAULT_LANGUAGE && region == EclipsiaStore.DEFAULT_REGION) return BASE
        val config = JSONObject().put("language", language).put("region", region).toString()
        return "$BASE/${URLEncoder.encode(config, "UTF-8")}"
    }

    private class Meta(val json: JSONObject, val kind: String)

    private suspend fun fetch(source: Source, page: Int, search: String? = null): List<Meta>? {
        val key = "${source.kind}:${source.id}"
        val offset = if (page <= 1) 0 else (page - 1) * (pageSizes[key] ?: DEFAULT_PAGE_SIZE)
        val tail = if (search != null) {
            val enc = URLEncoder.encode(search, "UTF-8").replace("+", "%20")
            "${source.id}/search=$enc" + if (offset > 0) "&skip=$offset" else ""
        } else if (offset > 0) "${source.id}/skip=$offset" else source.id
        val root = EclipsiaTmdb.getJson("${base()}/catalog/${source.kind}/$tail.json", TTL_MS) ?: return null
        val metas = root.optJSONArray("metas") ?: return null
        if (page <= 1 && search == null && metas.length() > 0) pageSizes[key] = metas.length()
        return metas.objects().map { Meta(it, source.kind) }
    }

    private fun interleave(lists: List<List<Meta>>): List<Meta> {
        val out = ArrayList<Meta>(lists.sumOf { it.size })
        val longest = lists.maxOfOrNull { it.size } ?: 0
        for (i in 0 until longest) lists.forEach { if (i < it.size) out += it[i] }
        return out
    }

    private fun toCards(metas: List<Meta>, requirePoster: Boolean): List<EclipsiaCatalog.Card> {
        val seen = HashSet<String>()
        val cards = ArrayList<EclipsiaCatalog.Card>(metas.size)
        for (entry in metas) {
            val meta = entry.json
            val shelfKind = entry.kind
            val raw = meta.text("id") ?: continue
            val title = meta.text("name") ?: continue
            val poster = meta.text("poster")?.takeIf { it.startsWith("https://", ignoreCase = true) }
                ?.replace("image.tmdb.org/t/p/w500/", "image.tmdb.org/t/p/w342/")
            if (requirePoster && poster == null) continue
            val declared = meta.text("type") ?: shelfKind
            val kind = if (declared == "series" || declared == "tv") "tv" else "movie"
            if (!seen.add("$kind:$raw")) continue
            val imdb = meta.text("imdb_id")?.takeIf { it.startsWith("tt") }
            cards += when {
                raw.startsWith("tmdb:") -> {
                    val id = raw.removePrefix("tmdb:").toIntOrNull()?.takeIf { it > 0 } ?: continue
                    EclipsiaCatalog.Card(id, kind, title, poster, imdb)
                }
                raw.startsWith("tt") ->
                    EclipsiaCatalog.Card(0, kind, title, poster, raw, "$HOME_URL/imdb/$kind/$raw")
                else -> continue
            }
        }
        return cards
    }

    suspend fun search(api: MainAPI, query: String, page: Int): EclipsiaCatalog.SearchPage? {
        val shelves = listOf(Source("movie", "popular-movies"), Source("series", "popular-series"))
        val fetched = coroutineScope { shelves.map { async { fetch(it, page, query) } }.awaitAll() }
        if (fetched.all { it == null }) return null
        val lists = fetched.filterNotNull()
        val metas = interleave(lists)
        val hasNext = lists.any { it.size >= DEFAULT_PAGE_SIZE }
        return EclipsiaCatalog.SearchPage(EclipsiaCatalog.render(api, toCards(metas, requirePoster = false)), hasNext)
    }

    suspend fun load(api: MainAPI, page: Int, name: String, query: String): HomePageResponse {
        val shelves = sources[query] ?: throw ErrorLoadingException("Row not available on Nuvio catalog")
        val fetched = coroutineScope { shelves.map { async { fetch(it, page) } }.awaitAll() }
        if (fetched.any { it == null }) throw ErrorLoadingException("Nuvio catalog request failed")
        val metas = interleave(fetched.filterNotNull())
        if (metas.isEmpty() && page <= 1) throw ErrorLoadingException("Nuvio catalog returned no items")

        val cards = toCards(metas, requirePoster = true)
        return newHomePageResponse(name, EclipsiaCatalog.render(api, cards), hasNext = metas.isNotEmpty())
    }
}
