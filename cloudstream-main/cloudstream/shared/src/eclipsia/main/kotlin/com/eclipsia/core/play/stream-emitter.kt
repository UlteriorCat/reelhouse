package com.eclipsia.core.play

import android.util.Base64
import com.eclipsia.core.map.JsStream
import com.eclipsia.core.map.JsSubtitle
import com.eclipsia.core.net.SafeHttp
import com.lagradost.cloudstream3.SubtitleFile
import com.lagradost.cloudstream3.newSubtitleFile
import com.lagradost.cloudstream3.utils.ExtractorLink
import com.lagradost.cloudstream3.utils.ExtractorLinkType
import com.lagradost.cloudstream3.utils.Qualities
import com.lagradost.cloudstream3.utils.SubtitleHelper
import com.lagradost.cloudstream3.utils.newExtractorLink

object StreamEmitter {
    suspend fun emit(
        providerId: String,
        providerName: String,
        stream: JsStream,
        seenSubtitles: MutableSet<String>,
        seenLinks: MutableSet<String>,
        caps: StreamCaps?,
        accept: (JsStream) -> Boolean,
        subtitleCallback: (SubtitleFile) -> Unit,
        callback: (ExtractorLink) -> Unit,
    ): Boolean {
        if (caps != null && caps.full(providerId)) return false
        if (!accept(stream)) return false

        val referer = HeaderRules.find(stream.headers, "referer").orEmpty()
        val linkKey = "${stream.url}|$referer"
        if (linkKey in seenLinks) return false

        val label = clean(stream.name ?: stream.title).ifBlank { providerName }
        val detail = listOfNotNull(stream.size, stream.language).joinToString(" \u2022 ")
        val display = if (detail.isBlank()) label else "$label \u2022 $detail"

        val otherHeaders = HeaderRules.without(stream.headers, "referer").let { h ->
            if (HeaderRules.find(h, "user-agent") != null) h else h + ("User-Agent" to SafeHttp.DEFAULT_UA)
        }

        var quality = QualityParser.heightOf(stream.quality) ?: QualityParser.heightOf(label)

        var playUrl = stream.url
        var inlinePlaylist = false
        val payload = DataUrls.parsePlaylist(stream.url)
        if (payload != null) {
            val text = try {
                if (payload.base64) String(Base64.decode(payload.data, Base64.DEFAULT), Charsets.UTF_8)
                else DataUrls.decodePlain(payload.data)
            } catch (_: Exception) {
                return false
            }
            if (!text.trimStart().startsWith("#EXTM3U")) return false
            if (quality == null) quality = MediaKinds.maxHlsHeight(text)
            inlinePlaylist = true
            playUrl = text
        }

        var kind = if (inlinePlaylist) MediaKind.HLS
        else MediaKinds.fromHint(stream.type) ?: MediaKinds.fromUrl(stream.url)
        if (!inlinePlaylist && kind != MediaKind.MAGNET && kind != MediaKind.TORRENT) {
            val probeHeaders = if (referer.isNotEmpty()) otherHeaders + ("Referer" to referer) else otherHeaders
            val probed = Prober.probe(stream.url, probeHeaders)
            if (probed != null) {
                if (probed.dead) return false
                if (probed.kind != null && (kind == null || probed.sure)) kind = probed.kind
                if (quality == null && probed.kind == MediaKind.HLS) quality = probed.height
            }
        }

        for (sub in stream.subtitles) {
            if (!seenSubtitles.add(sub.url)) continue
            subtitleCallback(newSubtitleFile(subtitleLabel(sub), sub.url) {
                if (sub.headers.isNotEmpty()) headers = sub.headers
            })
        }

        if (!seenLinks.add(linkKey)) return false
        if (caps != null && !caps.claim(providerId)) return false

        if (inlinePlaylist) playUrl = runCatching { LocalServer.publishResolved(playUrl) }.getOrNull() ?: return false

        callback(
            newExtractorLink(providerName, display, playUrl, linkType(kind)) {
                this.referer = referer
                this.quality = quality ?: Qualities.Unknown.value
                this.headers = otherHeaders
            }
        )
        return true
    }

    private fun linkType(kind: MediaKind?): ExtractorLinkType? = when (kind) {
        MediaKind.HLS -> ExtractorLinkType.M3U8
        MediaKind.DASH -> ExtractorLinkType.DASH
        MediaKind.PROGRESSIVE -> ExtractorLinkType.VIDEO
        MediaKind.MAGNET -> ExtractorLinkType.MAGNET
        MediaKind.TORRENT -> enumOrNull("TORRENT") ?: ExtractorLinkType.MAGNET
        MediaKind.SMOOTH -> enumOrNull("ISM") ?: ExtractorLinkType.VIDEO
        null -> null
    }

    private fun enumOrNull(name: String): ExtractorLinkType? =
        runCatching { ExtractorLinkType.valueOf(name) }.getOrNull()

    private fun clean(s: String?): String = s.orEmpty()
        .replace("﻿", "").replace("​", "")
        .replace(Regex("\\s*[\\r\\n]+\\s*"), " • ")
        .trim()

    @Suppress("DEPRECATION")
    private fun subtitleLabel(sub: JsSubtitle): String =
        SubtitleLabels.label(sub.language, sub.name) { code ->
            if (code.length == 2) SubtitleHelper.fromTwoLettersToLanguage(code)
            else SubtitleHelper.fromThreeLettersToLanguage(code)
        }
}
