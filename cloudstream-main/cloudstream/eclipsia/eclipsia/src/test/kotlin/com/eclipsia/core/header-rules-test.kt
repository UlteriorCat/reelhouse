package com.eclipsia.core

import com.eclipsia.core.play.HeaderRules
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class HeaderRulesTest {
    @Test
    fun validatesNamesAndValues() {
        assertTrue(HeaderRules.isValid("X-Token", "abc 123"))
        assertFalse(HeaderRules.isValid("Bad Name", "v"))
        assertFalse(HeaderRules.isValid("X", "line\nbreak"))
        assertFalse(HeaderRules.isValid("X", "café"))
    }

    @Test
    fun sanitizeDropsForbiddenEmptyAndInvalid() {
        val out = HeaderRules.sanitize(
            mapOf(
                "Range" to "bytes=0-1",
                "Content-Length" to "5",
                "Referer" to "https://a.example/",
                "X-Empty" to "  ",
                "Bad Name" to "v",
            )
        )
        assertEquals(mapOf("Referer" to "https://a.example/"), out)
    }

    @Test
    fun sanitizeKeepsLastCaseInsensitiveDuplicate() {
        val raw = LinkedHashMap<String, String>()
        raw["user-agent"] = "one"
        raw["User-Agent"] = "two"
        assertEquals(mapOf("User-Agent" to "two"), HeaderRules.sanitize(raw))
    }

    @Test
    fun normalizeUrl() {
        assertEquals("https://cdn.example/a.m3u8", HeaderRules.normalizeUrl("//cdn.example/a.m3u8"))
        assertEquals("https://x.example/a%20b", HeaderRules.normalizeUrl(" \"https://x.example/a b\" "))
        assertEquals("https://x.example/a/b?c=1&d=2", HeaderRules.normalizeUrl("https://x.example/a/b?c=1&amp;d=2"))
        assertEquals("magnet:?xt=urn:btih:abc", HeaderRules.normalizeUrl("magnet:?xt=urn:btih:abc"))
        assertNull(HeaderRules.normalizeUrl("javascript:alert(1)"))
        assertNull(HeaderRules.normalizeUrl("file:///etc/passwd"))
        assertNull(HeaderRules.normalizeUrl("data:text/html;base64,AAAA"))
        assertNull(HeaderRules.normalizeUrl(""))
    }

    @Test
    fun normalizeUrlAcceptsPlaylistDataUrls() {
        val url = "data:application/vnd.apple.mpegurl;base64,I0VYVE0zVQ=="
        assertEquals(url, HeaderRules.normalizeUrl(url))
    }
}
