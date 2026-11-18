package com.playz

import com.lagradost.cloudstream3.ErrorLoadingException
import com.lagradost.cloudstream3.HomePageList
import com.lagradost.cloudstream3.HomePageResponse
import com.lagradost.cloudstream3.LoadResponse
import com.lagradost.cloudstream3.MainAPI
import com.lagradost.cloudstream3.MainPageRequest
import com.lagradost.cloudstream3.SearchResponse
import com.lagradost.cloudstream3.SearchResponseList
import com.lagradost.cloudstream3.SubtitleFile
import com.lagradost.cloudstream3.TvType
import com.lagradost.cloudstream3.mainPageOf
import com.lagradost.cloudstream3.newHomePageResponse
import com.lagradost.cloudstream3.newLiveSearchResponse
import com.lagradost.cloudstream3.newLiveStreamLoadResponse
import com.lagradost.cloudstream3.newSearchResponseList
import com.lagradost.cloudstream3.newSubtitleFile
import com.lagradost.cloudstream3.utils.ExtractorLink
import com.lagradost.cloudstream3.utils.ExtractorLinkType
import com.lagradost.cloudstream3.utils.Qualities
import com.lagradost.cloudstream3.utils.newDrmExtractorLink
import com.lagradost.cloudstream3.utils.newExtractorLink
import com.playz.core.map.JsStream
import com.playz.core.play.HeaderRules
import com.playz.poster.PosterRenderer
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

class PlayzProvider(private val variant: PlayzVariant) : MainAPI() {
    override var name = variant.name
    override var mainUrl = variant.baseUrl
    override var lang = variant.lang
    override val hasMainPage = true
    override val hasQuickSearch = false
    override val supportedTypes = setOf(TvType.Live)
    override val mainPage = mainPageOf("home" to "Home")

    private fun JSONObject.text(key: String): String? =
        optString(key).trim().takeIf { it.isNotEmpty() && it != "null" }

    private fun JSONArray.objects(): List<JSONObject> =
        (0 until length()).mapNotNull { optJSONObject(it) }

    private suspend fun resolvePosters(items: List<JSONObject>, horizontal: Boolean): Map<String, String?> {
        val raw = items.mapNotNull { it.text("posterUrl") }.distinct()
        if (raw.isEmpty()) return emptyMap()
        val gate = Semaphore(PlayzSettings.posterConcurrency)
        return coroutineScope {
            raw.map { u ->
                async(Dispatchers.IO) { u to gate.withPermit { PosterRenderer.resolve(u, horizontal = horizontal) } }
            }.awaitAll().toMap()
        }
    }

    private fun toSearch(o: JSONObject, posters: Map<String, String?>): SearchResponse? {
        val url = o.text("url") ?: return null
        val title = o.text("title") ?: " "
        val poster = o.text("posterUrl")?.let { posters[it] }
        return newLiveSearchResponse(title, url, TvType.Live) { posterUrl = poster }
    }

    override suspend fun getMainPage(page: Int, request: MainPageRequest): HomePageResponse {
        if (page > 1) return newHomePageResponse(emptyList<HomePageList>(), hasNext = false)
        val data = PlayzEngine.call(variant, "getHome")?.optJSONObject("data")
            ?: throw ErrorLoadingException("Home request failed")
        val rows = LinkedHashMap<String, List<JSONObject>>()
        for (key in data.keys()) {
            val items = data.optJSONArray(key)?.objects().orEmpty()
            if (items.isNotEmpty()) rows[key] = items
        }
        val titles = rows.keys.toList()
        PlayzSettings.setSeenRows(titles)
        val enabled = PlayzSettings.rowOrder(titles).filter { PlayzSettings.rowEnabled(it) }
        val horizontal = PlayzSettings.horizontalPosters
        val posters = resolvePosters(enabled.flatMap { rows[it].orEmpty() }, horizontal)
        val lists = enabled.mapNotNull { row ->
            val items = rows[row].orEmpty().mapNotNull { toSearch(it, posters) }
            if (items.isEmpty()) null else HomePageList(row, items, horizontal)
        }
        if (lists.isEmpty()) throw ErrorLoadingException("Home is empty")
        return newHomePageResponse(lists, hasNext = false)
    }

    override suspend fun search(query: String): List<SearchResponse>? {
        val q = query.trim()
        if (q.isEmpty()) return emptyList()
        val objs = PlayzEngine.call(variant, "search", q)?.optJSONArray("data")?.objects() ?: return null
        val posters = resolvePosters(objs, false)
        return objs.mapNotNull { toSearch(it, posters) }
    }

    override suspend fun search(query: String, page: Int): SearchResponseList? =
        newSearchResponseList(if (page <= 1) search(query).orEmpty() else emptyList(), hasNext = false)

    override suspend fun load(url: String): LoadResponse? {
        val item = PlayzEngine.call(variant, "load", url)?.optJSONObject("data") ?: return null
        val title = item.text("title") ?: return null
        val playUrl = item.optJSONArray("episodes")?.objects()?.firstOrNull()?.text("url") ?: return null
        val rawPoster = item.text("posterUrl")
        val mainPoster = rawPoster?.let { PosterRenderer.resolve(it, PlayzSettings.POSTER_DETAIL_SCALE, horizontal = false) }
        val backdrop = rawPoster?.let { PosterRenderer.resolve(it, PlayzSettings.POSTER_DETAIL_SCALE, backdrop = true) }
        return newLiveStreamLoadResponse(title, url, playUrl) {
            posterUrl = mainPoster
            backgroundPosterUrl = backdrop ?: item.text("bannerUrl")
            plot = item.text("description")
        }
    }

    override suspend fun loadLinks(
        data: String,
        isCasting: Boolean,
        subtitleCallback: (SubtitleFile) -> Unit,
        callback: (ExtractorLink) -> Unit,
    ): Boolean {
        val arr = PlayzEngine.call(variant, "loadStreams", data)?.optJSONArray("data") ?: return false
        val streams = JsStream.parseList(arr.toString())
        var found = false
        val seen = HashSet<String>()
        val seenSubtitles = HashSet<String>()
        for (s in streams) {
            if (!seen.add(s.url)) continue
            for (sub in s.subtitles) {
                if (!seenSubtitles.add(sub.url)) continue
                subtitleCallback(newSubtitleFile(sub.name ?: sub.language, sub.url) {
                    if (sub.headers.isNotEmpty()) headers = sub.headers
                })
            }
            val referer = HeaderRules.find(s.headers, "referer").orEmpty()
            val others = HeaderRules.without(s.headers, "referer")
            val label = listOfNotNull(s.name, s.title).firstOrNull()?.takeIf { it.isNotBlank() } ?: variant.shortName
            val kind = when {
                s.type == "hls" || s.type == "m3u8" -> ExtractorLinkType.M3U8
                s.type == "dash" || s.type == "mpd" -> ExtractorLinkType.DASH
                s.type == "mp4" || s.type == "video" || s.type == "mkv" -> ExtractorLinkType.VIDEO
                s.url.contains(".m3u8", true) -> ExtractorLinkType.M3U8
                s.url.contains(".mpd", true) -> ExtractorLinkType.DASH
                else -> ExtractorLinkType.VIDEO
            }
            val q = s.quality?.let { QUALITY.find(it)?.value?.toIntOrNull() } ?: Qualities.Unknown.value
            val kid = s.drmKid?.let(::toBase64Url)
            val key = s.drmKey?.let(::toBase64Url)
            val license = s.licenseUrl
            val widevine = s.drmType.isNullOrEmpty() || s.drmType.contains("widevine")
            if (kid != null && key != null) {
                callback(
                    newDrmExtractorLink(name, label, s.url, kind, CLEARKEY_UUID) {
                        this.referer = referer
                        this.quality = q
                        this.headers = others
                        this.kid = kid
                        this.key = key
                    }
                )
            } else if (license != null && widevine) {
                callback(
                    newDrmExtractorLink(name, label, s.url, kind, WIDEVINE_UUID) {
                        this.referer = referer
                        this.quality = q
                        this.headers = others
                        this.licenseUrl = license
                    }
                )
            } else {
                callback(
                    newExtractorLink(name, label, s.url, kind) {
                        this.referer = referer
                        this.quality = q
                        this.headers = others
                    }
                )
            }
            found = true
        }
        return found
    }

    private fun toBase64Url(raw: String): String {
        val v = raw.trim()
        if (v.length % 2 != 0 || !HEX.matches(v)) return v
        val bytes = ByteArray(v.length / 2) { v.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
        return android.util.Base64.encodeToString(
            bytes,
            android.util.Base64.URL_SAFE or android.util.Base64.NO_PADDING or android.util.Base64.NO_WRAP,
        )
    }

    private companion object {
        val QUALITY = Regex("(\\d{3,4})")
        val HEX = Regex("^[0-9a-fA-F]+$")
        val CLEARKEY_UUID: UUID = UUID.fromString("e2719d58-a985-b3c9-781a-b030af78d30e")
        val WIDEVINE_UUID: UUID = UUID.fromString("edef8ba9-79d6-4ace-a3c8-27dcd51d21ed")
    }
}
