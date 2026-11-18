package com.eclipsia.core

import com.eclipsia.core.play.MediaKind
import com.eclipsia.core.play.MediaKinds
import com.eclipsia.core.play.QualityParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class MediaKindsTest {
    @Test
    fun fromUrl() {
        assertEquals(MediaKind.HLS, MediaKinds.fromUrl("https://a.example/v/master.m3u8?token=1"))
        assertEquals(MediaKind.DASH, MediaKinds.fromUrl("https://a.example/v/manifest.mpd"))
        assertEquals(MediaKind.PROGRESSIVE, MediaKinds.fromUrl("https://a.example/v/movie.MKV"))
        assertEquals(MediaKind.MAGNET, MediaKinds.fromUrl("magnet:?xt=urn:btih:abc"))
        assertEquals(MediaKind.TORRENT, MediaKinds.fromUrl("https://a.example/f.torrent"))
        assertEquals(MediaKind.SMOOTH, MediaKinds.fromUrl("https://a.example/v.ism/manifest"))
        assertEquals(MediaKind.HLS, MediaKinds.fromUrl("https://a.example/play?u=https%3A%2F%2Fb.example%2Fx.m3u8"))
        assertNull(MediaKinds.fromUrl("https://a.example/watch/12345"))
    }

    @Test
    fun fromContentType() {
        assertEquals(MediaKind.HLS, MediaKinds.fromContentType("application/vnd.apple.mpegurl; charset=utf-8"))
        assertEquals(MediaKind.DASH, MediaKinds.fromContentType("application/dash+xml"))
        assertEquals(MediaKind.PROGRESSIVE, MediaKinds.fromContentType("video/mp4"))
        assertNull(MediaKinds.fromContentType("text/html"))
        assertNull(MediaKinds.fromContentType(null))
    }

    @Test
    fun fromBytes() {
        assertEquals(MediaKind.HLS, MediaKinds.fromBytes("#EXTM3U\n#EXT-X-VERSION:3".toByteArray()))
        assertEquals(MediaKind.HLS, MediaKinds.fromBytes("\n  #EXTM3U".toByteArray()))
        assertEquals(MediaKind.DASH, MediaKinds.fromBytes("<?xml version=\"1.0\"?><MPD xmlns=\"x\">".toByteArray()))
        assertEquals(MediaKind.PROGRESSIVE, MediaKinds.fromBytes(byteArrayOf(0, 0, 0, 24, 'f'.code.toByte(), 't'.code.toByte(), 'y'.code.toByte(), 'p'.code.toByte())))
        assertEquals(MediaKind.PROGRESSIVE, MediaKinds.fromBytes(byteArrayOf(0x1A, 0x45, 0xDF.toByte(), 0xA3.toByte())))
        assertNull(MediaKinds.fromBytes("<html><body>blocked</body></html>".toByteArray()))
    }

    @Test
    fun maxHlsHeight() {
        val playlist = "#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=1280x720\na\n#EXT-X-STREAM-INF:RESOLUTION=1920x1080\nb"
        assertEquals(1080, MediaKinds.maxHlsHeight(playlist))
        assertNull(MediaKinds.maxHlsHeight("#EXTM3U"))
    }

    @Test
    fun qualityParser() {
        assertEquals(1080, QualityParser.heightOf("Server 1080p HDR"))
        assertEquals(2160, QualityParser.heightOf("4K"))
        assertEquals(720, QualityParser.heightOf("1280x720"))
        assertEquals(480, QualityParser.heightOf("480"))
        assertNull(QualityParser.heightOf("HD"))
        assertNull(QualityParser.heightOf(null))
    }
}
