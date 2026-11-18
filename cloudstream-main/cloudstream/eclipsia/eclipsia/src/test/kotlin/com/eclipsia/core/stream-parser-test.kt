package com.eclipsia.core

import com.eclipsia.core.map.JsStream
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
}
