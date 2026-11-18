package com.eclipsia.core

import com.eclipsia.core.play.StreamCaps
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class StreamCapsTest {
    @Test
    fun unlimitedWhenZero() {
        val caps = StreamCaps(0, false) { 0 }
        repeat(1000) { assertTrue(caps.claim("a")) }
        assertFalse(caps.full("a"))
    }

    @Test
    fun totalCapIsEnforced() {
        val caps = StreamCaps(3, false) { 0 }
        assertTrue(caps.claim("a"))
        assertTrue(caps.claim("b"))
        assertTrue(caps.claim("a"))
        assertTrue(caps.full("c"))
        assertFalse(caps.claim("c"))
    }

    @Test
    fun perProviderCapIsEnforced() {
        val caps = StreamCaps(0, true) { 2 }
        assertTrue(caps.claim("a"))
        assertTrue(caps.claim("a"))
        assertFalse(caps.claim("a"))
        assertTrue(caps.full("a"))
        assertFalse(caps.full("b"))
        assertTrue(caps.claim("b"))
    }
}
