package com.eclipsiaanime

import com.eclipsia.core.catalog.EclipsiaTmdb
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
import com.eclipsia.core.play.StreamCaps
import com.eclipsia.core.play.SubtitleLabels
import com.lagradost.cloudstream3.ProviderType
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
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean

open class EclipsiaAnimeProvider : TmdbProvider() {
    override var name = "EclipsiaAnime"
    override val apiName = "EclipsiaAnime"
    override var mainUrl = "https://www.themoviedb.org"
    override var lang = "en"
    override val useMetaLoadResponse = true
    override val providerType = ProviderType.DirectProvider
    override val instantLinkLoading = true
    override val supportedTypes = setOf(TvType.Movie, TvType.TvSeries)
    override val hasMainPage = true

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
        val caps = StreamCaps(EclipsiaStore.totalCap, EclipsiaStore.perProviderCapEnabled) { EclipsiaStore.providerCap(it) }
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
                                    if (emit(scraper, stream, seenSubtitles, seenLinks, caps, subtitleCallback, callback)) {
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
        val text = EclipsiaTmdb.get("find/$imdb?external_source=imdb_id", ttlMs = EclipsiaTmdb.TTL_LONG_MS) ?: return null
        val root = runCatching { JSONObject(text) }.getOrNull() ?: return null
        fun first(key: String): JSONObject? = root.optJSONArray(key)?.optJSONObject(0)

        first("tv_episode_results")?.let { ep ->
            val show = ep.optInt("show_id", 0)
            if (show > 0) {
                return Target(
                    show.toString(),
                    season ?: ep.optInt("season_number", -1).takeIf { it >= 0 },
                    episode ?: ep.optInt("episode_number", -1).takeIf { it >= 0 },
                    true,
                )
            }
        }
        val order = if (tvHint) listOf("tv_results" to true, "movie_results" to false)
        else listOf("movie_results" to false, "tv_results" to true)
        for ((key, tv) in order) {
            val id = first(key)?.optInt("id", 0) ?: 0
            if (id > 0) return Target(id.toString(), season, episode, tv)
        }
        return null
    }

    private suspend fun emit(
        scraper: EclipsiaScraper,
        stream: JsStream,
        seenSubtitles: MutableSet<String>,
        seenLinks: MutableSet<String>,
        caps: StreamCaps,
        subtitleCallback: (SubtitleFile) -> Unit,
        callback: (ExtractorLink) -> Unit,
    ): Boolean = StreamEmitter.emit(
        scraper.id, scraper.name, stream, seenSubtitles, seenLinks, caps, { LanguageFilter.allows(it) }, subtitleCallback, callback,
    )
}
