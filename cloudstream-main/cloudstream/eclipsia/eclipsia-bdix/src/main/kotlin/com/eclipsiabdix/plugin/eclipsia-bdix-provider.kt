package com.eclipsiabdix

import com.eclipsia.core.catalog.EclipsiaIMDbApi
import com.eclipsia.core.catalog.EclipsiaIMDbDetails
import android.util.Base64
import com.eclipsia.core.map.JsStream
import com.eclipsia.core.map.JsSubtitle
import com.eclipsia.core.net.SafeHttp
import com.eclipsia.core.play.DataUrls
import com.eclipsia.core.play.HeaderRules
import com.eclipsia.core.play.LocalServer
import com.eclipsia.core.play.MediaKind
import com.eclipsia.core.play.MediaKinds
import com.eclipsia.core.play.StreamEmitter
import com.eclipsia.core.play.QualityParser
import com.eclipsia.core.play.SubtitleLabels
import com.lagradost.cloudstream3.HomePageResponse
import com.lagradost.cloudstream3.LoadResponse
import com.lagradost.cloudstream3.MainPageData
import com.lagradost.cloudstream3.MainPageRequest
import com.lagradost.cloudstream3.ProviderType
import com.lagradost.cloudstream3.SearchResponse
import com.lagradost.cloudstream3.SearchResponseList
import com.lagradost.cloudstream3.newSearchResponseList
import com.lagradost.cloudstream3.SubtitleFile
import com.lagradost.cloudstream3.TvType
import com.lagradost.cloudstream3.metaproviders.TmdbLink
import com.lagradost.cloudstream3.metaproviders.TmdbProvider
import com.lagradost.cloudstream3.newSubtitleFile
import com.lagradost.cloudstream3.utils.AppUtils.parseJson
import com.lagradost.cloudstream3.utils.ExtractorLink
import com.lagradost.cloudstream3.utils.ExtractorLinkType
import com.lagradost.cloudstream3.utils.Qualities
import com.lagradost.cloudstream3.utils.SubtitleHelper
import com.lagradost.cloudstream3.utils.newExtractorLink
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withTimeoutOrNull
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean

class EclipsiaBDIXProvider : TmdbProvider() {
    override var name = "Eclipsia\u200BBDIX"
    override val apiName = "EclipsiaBDIX"
    override var mainUrl = "https://www.imdb.com"
    override var lang = "en"
    override val useMetaLoadResponse = false
    override val providerType = ProviderType.DirectProvider
    override val instantLinkLoading = true
    override val supportedTypes = setOf(TvType.Movie, TvType.TvSeries)
    override val hasMainPage = true
    override val mainPage: List<MainPageData>
        get() = EclipsiaIMDbApi.activeRows()

    override suspend fun load(url: String): LoadResponse? =
        with(EclipsiaIMDbDetails) { loadIMDb(url) }

    override suspend fun getMainPage(page: Int, request: MainPageRequest): HomePageResponse =
        EclipsiaIMDbApi.page(this, page, request)

    override suspend fun search(query: String): List<SearchResponse>? =
        EclipsiaIMDbApi.search(this, query)

    override suspend fun search(query: String, page: Int): SearchResponseList? =
        newSearchResponseList(if (page <= 1) EclipsiaIMDbApi.search(this, query) else emptyList(), hasNext = false)

    private class Target(val tmdbId: String, val season: Int?, val episode: Int?, val isTv: Boolean)

    override suspend fun loadLinks(
        data: String,
        isCasting: Boolean,
        subtitleCallback: (SubtitleFile) -> Unit,
        callback: (ExtractorLink) -> Unit,
    ): Boolean {
        val link = runCatching { parseJson<TmdbLink>(data) }.getOrNull() ?: return false
        val target = resolveTarget(link) ?: return false

        if (target.isTv && (target.season == null || target.episode == null)) return false
        val mediaType = if (target.isTv) "tv" else "movie"

        val scrapers = EclipsiaRepository.active(mediaType)
        if (scrapers.isEmpty()) return false

        val found = AtomicBoolean(false)
        val seenSubtitles = ConcurrentHashMap.newKeySet<String>()
        val seenLinks = ConcurrentHashMap.newKeySet<String>()
        val deadlineMs = EclipsiaStore.timeoutSeconds * 1000L
        suspend fun <T> withDeadline(block: suspend () -> T): T? =
            if (deadlineMs > 0) withTimeoutOrNull(deadlineMs) { block() } else block()
        withDeadline {
            coroutineScope {
                scrapers.map { scraper ->
                    async {
                        val streams = try {
                            EclipsiaEngine.runner.callScraper(EclipsiaRepository.ref(scraper), target.tmdbId, mediaType, target.season, target.episode)
                        } catch (e: CancellationException) {
                            throw e
                        } catch (_: Exception) {
                            emptyList()
                        }
                        streams.map { stream ->
                            async {
                                try {
                                    if (emit(scraper, stream, seenSubtitles, seenLinks, subtitleCallback, callback)) {
                                        found.set(true)
                                    }
                                } catch (e: CancellationException) {
                                    throw e
                                } catch (_: Exception) {
                                }
                            }
                        }.awaitAll()
                    }
                }.awaitAll()
            }
        }
        return found.get()
    }

    private suspend fun resolveTarget(link: TmdbLink): Target? {
        val season = link.season
        val episode = link.episode
        val tvHint = season != null || episode != null

        link.tmdbID?.let { return Target(it.toString(), season, episode, tvHint) }

        val imdb = link.imdbID?.trim()?.takeIf { it.startsWith("tt") } ?: return null
        val found = EclipsiaTmdbLookup.resolve(imdb, season, episode, tvHint) ?: return null
        return Target(found.tmdbId.toString(), found.season, found.episode, found.isTv)
    }

    private suspend fun emit(
        scraper: EclipsiaScraper,
        stream: JsStream,
        seenSubtitles: MutableSet<String>,
        seenLinks: MutableSet<String>,
        subtitleCallback: (SubtitleFile) -> Unit,
        callback: (ExtractorLink) -> Unit,
    ): Boolean = StreamEmitter.emit(
        scraper.id, scraper.name, stream, seenSubtitles, seenLinks, null, { true }, subtitleCallback, callback,
    )
}
