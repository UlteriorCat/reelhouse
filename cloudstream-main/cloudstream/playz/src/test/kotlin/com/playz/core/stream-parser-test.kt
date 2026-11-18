package com.playz.core

import com.playz.core.map.JsStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class StreamParserTest {
    @Test
    fun rejectsInvalidInput() {
        assertTrue(JsStream.parseList("not json").isEmpty())
        assertTrue(JsStream.parseList("{}").isEmpty())
        assertTrue(JsStream.parseList("[]").isEmpty())
        assertTrue(JsStream.parseList("[null, 5, {\"title\": \"x\"}]").isEmpty())
    }

    @Test
    fun parsesAndSanitizesStream() {
        val raw = """[{
            "url": "//cdn.example/v/index.m3u8",
            "name": "  Server A ",
            "quality": "1080p",
            "type": "HLS",
            "title": "[object Object]",
            "headers": {"Referer": "https://site.example/", "Range": "bytes=0-", "X-Num": 5},
            "subtitles": [
                {"url": "https://s.example/en.vtt", "language": "en", "name": "English"},
                {"url": "ftp://bad.example/x.vtt", "language": "fr"}
            ]
        }]"""
        val streams = JsStream.parseList(raw)
        assertEquals(1, streams.size)
        val s = streams[0]
        assertEquals("https://cdn.example/v/index.m3u8", s.url)
        assertEquals("Server A", s.name)
        assertEquals(null, s.title)
        assertEquals("hls", s.type)
        assertEquals(mapOf("Referer" to "https://site.example/", "X-Num" to "5"), s.headers)
        assertEquals(1, s.subtitles.size)
        assertEquals("en", s.subtitles[0].language)
    }

    @Test
    fun capsStreamCount() {
        val items = (1..400).joinToString(",") { "{\"url\":\"https://a.example/$it.mp4\"}" }
        assertEquals(300, JsStream.parseList("[$items]").size)
    }

    @Test
    fun acceptsUrlObject() {
        val streams = JsStream.parseList("""[{"url": {"url": "https://a.example/v.mp4"}}]""")
        assertEquals("https://a.example/v.mp4", streams.single().url)
    }

    @Test
    fun parsesDrmFields() {
        val raw = """[
            {"url": "https://cdn.example/a.mpd", "drmType": "ClearKey", "drmKid": "0123456789abcdef0123456789abcdef", "drmKey": "fedcba9876543210fedcba9876543210"},
            {"url": "https://cdn.example/b.mpd", "drmType": "widevine", "licenseUrl": "https://lic.example/wv"},
            {"url": "https://cdn.example/c.m3u8"}
        ]"""
        val streams = JsStream.parseList(raw)
        assertEquals(3, streams.size)
        assertEquals("clearkey", streams[0].drmType)
        assertEquals("0123456789abcdef0123456789abcdef", streams[0].drmKid)
        assertEquals("fedcba9876543210fedcba9876543210", streams[0].drmKey)
        assertEquals(null, streams[0].licenseUrl)
        assertEquals("widevine", streams[1].drmType)
        assertEquals("https://lic.example/wv", streams[1].licenseUrl)
        assertEquals(null, streams[1].drmKey)
        assertEquals(null, streams[2].drmType)
        assertEquals(null, streams[2].drmKid)
        assertEquals(null, streams[2].licenseUrl)
    }
}
