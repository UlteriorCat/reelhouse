package com.eclipsia.core.play

import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

class StreamCaps(
    private val total: Int,
    private val perProviderEnabled: Boolean,
    private val providerCap: (String) -> Int,
) {
    private val sent = AtomicInteger(0)
    private val counts = ConcurrentHashMap<String, AtomicInteger>()
    private val caps = ConcurrentHashMap<String, Int>()

    private fun cap(id: String): Int =
        if (!perProviderEnabled) 0 else caps.getOrPut(id) { providerCap(id) }

    private fun counter(id: String) = counts.getOrPut(id) { AtomicInteger(0) }

    fun full(id: String): Boolean {
        if (total > 0 && sent.get() >= total) return true
        val c = cap(id)
        return c > 0 && counter(id).get() >= c
    }

    fun claim(id: String): Boolean {
        val c = cap(id)
        if (c > 0 && counter(id).incrementAndGet() > c) return false
        if (total > 0 && sent.incrementAndGet() > total) return false
        return true
    }
}
