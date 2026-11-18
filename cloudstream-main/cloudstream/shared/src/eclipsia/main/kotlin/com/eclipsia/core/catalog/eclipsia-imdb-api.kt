package com.eclipsia.core.catalog

import com.eclipsia.core.json.text
import com.eclipsia.core.json.objects
import com.eclipsia.core.json.strings
import com.eclipsia.core.net.FetchTuning
import com.eclipsia.core.net.RawResponse
import com.eclipsia.core.net.jsonFetcher
import com.lagradost.cloudstream3.HomePageResponse
import com.lagradost.cloudstream3.MainAPI
import com.lagradost.cloudstream3.MainPageData
import com.lagradost.cloudstream3.MainPageRequest
import com.lagradost.cloudstream3.Score
import com.lagradost.cloudstream3.SearchResponse
import com.lagradost.cloudstream3.TvType
import com.lagradost.cloudstream3.app
import com.lagradost.cloudstream3.mainPageOf
import com.lagradost.cloudstream3.newHomePageResponse
import com.lagradost.cloudstream3.newMovieSearchResponse
import com.lagradost.cloudstream3.newTvSeriesSearchResponse
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject
import java.net.URLEncoder
import java.util.concurrent.ConcurrentHashMap

internal object EclipsiaIMDbApi {
    const val PREFIX = "imdb:"
    const val BASE = "https://v3-cinemeta.strem.io"
    const val HOME_URL = "https://www.imdb.com"
    private const val SUGGEST_BASE = "https://v3.sg.media-imdb.com/suggestion"
    private const val IMAGE_PROXY = "https://wsrv.nl/?url="
    private const val POSTER_HOST = "https://images.metahub.space/poster/medium"
    private const val FETCH_TIMEOUT_MS = 12_000L
    private const val PROBE_TIMEOUT_MS = 6_000L
    private const val TTL_MS = 10 * 60 * 1000L
    private const val MAX_ENTRIES = 160

    private class Shelf(val key: String, val kind: String, val catalog: String) {
        val label = key.removePrefix("IMDb ")
        val query = "$PREFIX$kind:$catalog"
    }

    private val shelves = listOf(
        Shelf("IMDb Popular Movies", "movie", "top"),
        Shelf("IMDb Popular Series", "series", "top"),
        Shelf("IMDb New Movies", "movie", "year"),
        Shelf("IMDb New Series", "series", "year"),
        Shelf("IMDb Featured Movies", "movie", "imdbRating"),
        Shelf("IMDb Featured Series", "series", "imdbRating"),
    )

    val titles: List<String> = shelves.map { it.key }
    val labels: List<String> = shelves.map { it.label }

    private var rowOrder: (List<String>) -> List<String> = { it }
    private var rowEnabled: (String) -> Boolean = { true }

    fun init(order: (List<String>) -> List<String>, enabled: (String) -> Boolean) {
        rowOrder = order
        rowEnabled = enabled
    }

    fun activeRows(): List<MainPageData> {
        val order = rowOrder(titles)
        val visible = shelves.sortedBy { order.indexOf(it.key) }
            .filter { rowEnabled(it.key) }
        return mainPageOf(*visible.map { it.query to it.label }.toTypedArray())
    }

    private val fetcher = jsonFetcher(
        FetchTuning(
            parallel = 8,
            maxEntries = MAX_ENTRIES,
            attemptTimeoutMs = FETCH_TIMEOUT_MS,
            attempts = 2,
        ),
    )

    private val consumed = ConcurrentHashMap<String, Int>()
    private val probes = ConcurrentHashMap<String, Boolean>()

    private suspend fun getJson(url: String): JSONObject? {
        val lane = if (url.startsWith(SUGGEST_BASE)) "suggest" else "cinemeta"
        return fetcher.get(url, TTL_MS, lane) {
            val resp = app.get(url, timeout = FETCH_TIMEOUT_MS)
            RawResponse(resp.code, if (resp.code in 200..299) resp.text else null, resp.headers["Retry-After"])
        }
    }

    suspend fun fetch(path: String): JSONObject? = getJson("$BASE/$path")

    fun proxy(url: String?): String? {
        if (url.isNullOrBlank() || !url.startsWith("https://", ignoreCase = true)) return null
        return if ("metahub.space" in url || "kitsu." in url) IMAGE_PROXY + url else url
    }

    fun linkOf(id: String, kind: String) = "$HOME_URL/title/$id/?kind=$kind"

    private suspend fun imageReachable(url: String): Boolean {
        probes[url]?.let { return it }
        val ok = try {
            withTimeoutOrNull(PROBE_TIMEOUT_MS) { app.head(url).code == 200 } ?: false
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            false
        }
        if (probes.size > 800) probes.clear()
        probes[url] = ok
        return ok
    }

    private suspend fun suggestedImages(text: String): Map<String, Boolean> {
        val lower = text.lowercase()
        val head = lower.firstOrNull()?.takeIf { it in 'a'..'z' || it in '0'..'9' } ?: 'x'
        val encoded = URLEncoder.encode(lower, "UTF-8").replace("+", "%20")
        val root = getJson("$SUGGEST_BASE/$head/$encoded.json") ?: return emptyMap()
        val found = HashMap<String, Boolean>()
        for (item in root.optJSONArray("d").objects()) {
            val id = item.text("id")?.takeIf { it.startsWith("tt") } ?: continue
            found[id] = item.optJSONObject("i")?.text("imageUrl") != null
        }
        return found
    }

    private class Item(val id: String, val kind: String, val title: String, val image: String?, val rating: Score?)

    private fun parse(json: JSONObject, fallbackKind: String, searching: Boolean): Item? {
        val id = (json.text("imdb_id") ?: json.text("id"))?.takeIf { it.startsWith("tt") } ?: return null
        val kind = json.text("type")?.takeIf { it == "movie" || it == "series" } ?: fallbackKind
        val title = json.optJSONArray("aliases").strings().firstOrNull() ?: json.text("name") ?: return null
        val image = if (searching) "$POSTER_HOST/$id/img" else json.text("poster")
        val rating = json.text("imdbRating")?.toDoubleOrNull()?.let { Score.from10(it) }
        return Item(id, kind, title, image, rating)
    }

    private fun render(api: MainAPI, item: Item): SearchResponse {
        val cover = EclipsiaPosters.resolveImdb(item.kind, item.id, proxy(item.image))
        val label = EclipsiaPosters.cardLabel(item.title)
        val target = linkOf(item.id, item.kind)
        return if (item.kind == "movie") api.newMovieSearchResponse(label, target, TvType.Movie) {
            posterUrl = cover
            score = item.rating
        } else api.newTvSeriesSearchResponse(label, target, TvType.TvSeries) {
            posterUrl = cover
            score = item.rating
        }
    }

    suspend fun page(api: MainAPI, page: Int, request: MainPageRequest): HomePageResponse =
        EclipsiaParallel.page(api, page, request.name, request.data, activeRows()) { p, name, data ->
            load(api, p, name, data)
        }

    private suspend fun load(api: MainAPI, page: Int, name: String, data: String): HomePageResponse {
        val parts = data.removePrefix(PREFIX).split(':', limit = 2)
        val kind = parts[0]
        val catalog = parts.getOrElse(1) { "top" }
        if (page <= 1) consumed.remove(data)
        val offset = consumed[data] ?: 0
        val tail = if (offset > 0) "$catalog/skip=$offset" else catalog
        val root = getJson("$BASE/catalog/$kind/$tail.json")
            ?: return newHomePageResponse(name, emptyList(), hasNext = false)
        val metas = root.optJSONArray("metas").objects()
        consumed[data] = offset + metas.size

        val cards = metas.mapNotNull { parse(it, kind, false) }
            .filter { it.image != null }
        return newHomePageResponse(name, cards.map { render(api, it) }, hasNext = metas.isNotEmpty())
    }

    suspend fun search(api: MainAPI, query: String): List<SearchResponse> {
        val text = query.trim()
        if (text.isEmpty()) return emptyList()
        val encoded = URLEncoder.encode(text, "UTF-8").replace("+", "%20")
        return coroutineScope {
            val known = async { suggestedImages(text) }
            val lanes = listOf("movie", "series").map { kind ->
                async {
                    getJson("$BASE/catalog/$kind/top/search=$encoded.json")
                        ?.optJSONArray("metas").objects()
                        .mapNotNull { parse(it, kind, true) }
                }
            }.awaitAll()
            val verdicts = known.await()
            val checked = lanes.map { lane ->
                lane.map { item ->
                    async {
                        val image = item.image
                        when {
                            image == null -> null
                            verdicts[item.id] == false -> null
                            verdicts[item.id] == true -> item
                            else -> withTimeoutOrNull(3_000L) { imageReachable(image) }
                                ?.let { ok -> if (ok) item else null } ?: item
                        }
                    }
                }.awaitAll().filterNotNull()
            }
            val longest = checked.maxOfOrNull { it.size } ?: 0
            (0 until longest).flatMap { i -> checked.mapNotNull { it.getOrNull(i) } }.map { render(api, it) }
        }
    }
}
