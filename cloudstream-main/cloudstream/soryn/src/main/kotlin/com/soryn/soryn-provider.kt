package com.soryn

import com.lagradost.cloudstream3.Actor
import com.lagradost.cloudstream3.ActorData
import com.lagradost.cloudstream3.HomePageList
import com.lagradost.cloudstream3.HomePageResponse
import com.lagradost.cloudstream3.MainAPI
import com.lagradost.cloudstream3.MainPageRequest
import com.lagradost.cloudstream3.ErrorLoadingException
import com.lagradost.cloudstream3.LoadResponse
import com.lagradost.cloudstream3.Score
import com.lagradost.cloudstream3.SearchResponse
import com.lagradost.cloudstream3.SearchResponseList
import com.lagradost.cloudstream3.ShowStatus
import com.lagradost.cloudstream3.SubtitleFile
import com.lagradost.cloudstream3.TvType
import com.lagradost.cloudstream3.mainPageOf
import com.lagradost.cloudstream3.newEpisode
import com.lagradost.cloudstream3.newHomePageResponse
import com.lagradost.cloudstream3.newMovieLoadResponse
import com.lagradost.cloudstream3.newMovieSearchResponse
import com.lagradost.cloudstream3.newSubtitleFile
import com.lagradost.cloudstream3.newSearchResponseList
import com.lagradost.cloudstream3.newTvSeriesLoadResponse
import com.lagradost.cloudstream3.newTvSeriesSearchResponse
import com.lagradost.cloudstream3.utils.ExtractorLink
import com.lagradost.cloudstream3.utils.ExtractorLinkType
import com.lagradost.cloudstream3.utils.Qualities
import com.lagradost.cloudstream3.utils.newExtractorLink
import com.soryn.core.map.JsStream
import com.soryn.core.play.HeaderRules
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONArray
import org.json.JSONObject

class SorynProvider(private val variant: SorynVariant) : MainAPI() {
    override var name = SorynSettings.displayName(variant)
    override var mainUrl = variant.baseUrl
    override var lang = variant.lang
    override val hasMainPage = variant.home
    override val hasQuickSearch = false
    override val supportedTypes = setOf(TvType.Movie, TvType.TvSeries)
    override val mainPage = mainPageOf(variant.baseUrl to "Home")

    private fun JSONObject.text(key: String): String? =
        optString(key).trim().takeIf { it.isNotEmpty() && it != "null" }

    private fun isSeries(o: JSONObject) = o.optString("type").equals("series", true)

    private val idRegex = Regex("[?&]id=([^&#]+)")

    private fun idOf(url: String): String = idRegex.find(url)?.groupValues?.get(1).orEmpty()

    private fun parseCards(arr: JSONArray?): List<SorynCard> {
        arr ?: return emptyList()
        return (0 until arr.length()).mapNotNull { i ->
            val o = arr.optJSONObject(i) ?: return@mapNotNull null
            val url = o.text("url") ?: return@mapNotNull null
            SorynCard(o.text("title").orEmpty(), url, o.text("posterUrl"), isSeries(o))
        }
    }

    private fun toResponse(c: SorynCard, titles: Map<String, String> = emptyMap(), useCache: Boolean = true): SearchResponse {
        val id = idOf(c.url)
        val title = c.title.ifBlank { titles[id] ?: (if (useCache) SorynTitles.get(variant.id, id) else null) ?: " " }
        return if (c.series) newTvSeriesSearchResponse(title, c.url, TvType.TvSeries) { posterUrl = c.poster }
        else newMovieSearchResponse(title, c.url, TvType.Movie) { posterUrl = c.poster }
    }

    private fun cards(arr: JSONArray?): List<SearchResponse> = parseCards(arr).map { toResponse(it) }

    private suspend fun resolveTitles(cards: List<SorynCard>): Map<String, String> {
        val ids = cards.filter { it.title.isBlank() }.map { idOf(it.url) }.filter { it.isNotEmpty() }.distinct()
        val missing = ids.filter { SorynTitles.get(variant.id, it) == null }
        if (missing.isEmpty()) return emptyMap()
        val found = coroutineScope {
            missing.chunked(TITLE_BATCH).map { batch ->
                async {
                    withTimeoutOrNull(TITLE_TIMEOUT_MS) {
                        SorynEngine.call(variant, "titles", JSONArray(batch).toString())?.optJSONObject("data")
                    }
                }
            }.awaitAll()
        }
        val out = HashMap<String, String>()
        for (obj in found) {
            obj ?: continue
            for (k in obj.keys()) obj.optString(k).takeIf { it.isNotBlank() }?.let { out[k] = it }
        }
        SorynTitles.putAll(variant.id, out)
        return out
    }

    override suspend fun getMainPage(page: Int, request: MainPageRequest): HomePageResponse {
        if (page > 1) return newHomePageResponse(emptyList<HomePageList>(), hasNext = false)
        val data = SorynEngine.call(variant, "getHome")?.optJSONObject("data")
            ?: throw ErrorLoadingException("Home request failed")
        val raw = LinkedHashMap<String, List<SorynCard>>()
        for (key in data.keys()) {
            val items = parseCards(data.optJSONArray(key))
            if (items.isNotEmpty()) raw[key] = items
        }
        SorynSettings.recordRows(variant.id, raw.keys.toList())
        val shown = SorynSettings.applyRows(variant.id, raw)
        val titles = if (SorynSettings.hideLabels) emptyMap() else resolveTitles(shown.flatMap { it.second })
        val useCache = !SorynSettings.hideLabels
        val lists = shown.map { (rowName, items) -> HomePageList(rowName, items.map { toResponse(it, titles, useCache) }) }
        if (lists.isEmpty()) throw ErrorLoadingException("Home is empty")
        return newHomePageResponse(lists, hasNext = false)
    }

    override suspend fun search(query: String): List<SearchResponse>? {
        val q = query.trim()
        if (q.isEmpty()) return emptyList()
        return cards(SorynEngine.call(variant, "search", q)?.optJSONArray("data"))
    }

    override suspend fun search(query: String, page: Int): SearchResponseList? =
        newSearchResponseList(if (page <= 1) search(query).orEmpty() else emptyList(), hasNext = false)

    override suspend fun load(url: String): LoadResponse? {
        val d = SorynEngine.call(variant, "load", url)?.optJSONObject("data") ?: return null
        val title = d.text("title") ?: return null
        val pageUrl = d.text("url") ?: url
        val episodes = d.optJSONArray("episodes")
        val epList = (0 until (episodes?.length() ?: 0)).mapNotNull { episodes?.optJSONObject(it) }

        val actorList = d.optJSONArray("cast")?.let { a ->
            (0 until a.length()).mapNotNull { i ->
                val c = a.optJSONObject(i) ?: return@mapNotNull null
                val n = c.text("name") ?: return@mapNotNull null
                ActorData(Actor(n, c.text("image")), roleString = c.text("role"))
            }
        }.orEmpty()
        val related = cards(d.optJSONArray("recommendations"))
        val scoreValue = d.optDouble("score", 0.0).takeIf { it > 0 }?.let { Score.from10(it) }
        val yearValue = d.optInt("year", 0).takeIf { it > 0 }
        val minutes = d.optInt("duration", 0).takeIf { it > 0 }

        if (!isSeries(d)) {
            val data = epList.firstOrNull()?.text("url") ?: pageUrl
            return newMovieLoadResponse(title, pageUrl, TvType.Movie, data) {
                posterUrl = d.text("posterUrl")
                backgroundPosterUrl = d.text("bannerUrl")
                plot = d.text("description")
                year = yearValue
                duration = minutes
                contentRating = d.text("contentRating")
                score = scoreValue
                actors = actorList
                recommendations = related
            }
        }

        val eps = epList.mapNotNull { ep ->
            val epUrl = ep.text("url") ?: return@mapNotNull null
            newEpisode(epUrl) {
                name = ep.text("name")
                season = ep.optInt("season", 1).takeIf { it > 0 }
                episode = ep.optInt("episode", 0).takeIf { it > 0 }
                posterUrl = ep.text("posterUrl")
                description = ep.text("description")
                runTime = ep.optInt("runtime", 0).takeIf { it > 0 }
            }
        }
        return newTvSeriesLoadResponse(title, pageUrl, TvType.TvSeries, eps) {
            posterUrl = d.text("posterUrl")
            backgroundPosterUrl = d.text("bannerUrl")
            plot = d.text("description")
            year = yearValue
            contentRating = d.text("contentRating")
            score = scoreValue
            showStatus = if (d.optString("status") == "completed") ShowStatus.Completed else ShowStatus.Ongoing
            actors = actorList
            recommendations = related
        }
    }

    override suspend fun loadLinks(
        data: String,
        isCasting: Boolean,
        subtitleCallback: (SubtitleFile) -> Unit,
        callback: (ExtractorLink) -> Unit,
    ): Boolean {
        val arr = SorynEngine.call(variant, "loadStreams", data)?.optJSONArray("data") ?: return false
        val streams = JsStream.parseList(arr.toString())
        var found = false
        val seenSubtitles = HashSet<String>()
        for (s in streams) {
            for (sub in s.subtitles) {
                if (!seenSubtitles.add(sub.url)) continue
                subtitleCallback(newSubtitleFile(sub.name ?: sub.language, sub.url) {
                    if (sub.headers.isNotEmpty()) headers = sub.headers
                })
            }
            val referer = HeaderRules.find(s.headers, "referer").orEmpty()
            val others = HeaderRules.without(s.headers, "referer")
            val label = listOfNotNull(s.name, s.title).firstOrNull()?.takeIf { it.isNotBlank() } ?: variant.shortName
            val type = when {
                s.type == "hls" || s.url.contains(".m3u8", true) -> ExtractorLinkType.M3U8
                s.type == "dash" || s.url.contains(".mpd", true) -> ExtractorLinkType.DASH
                s.type == "mp4" || s.url.contains(".mp4", true) -> ExtractorLinkType.VIDEO
                else -> null
            }
            val q = s.quality?.let { Regex("(\\d{3,4})").find(it)?.value?.toIntOrNull() } ?: Qualities.Unknown.value
            callback(
                newExtractorLink(variant.shortName, label, s.url, type) {
                    this.referer = referer
                    this.quality = q
                    this.headers = others
                }
            )
            found = true
        }
        return found
    }

    private companion object {
        const val TITLE_BATCH = 24
        const val TITLE_TIMEOUT_MS = 30_000L
    }
}
