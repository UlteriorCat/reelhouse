package com.eclipsia.core.net

import okhttp3.Cookie
import okhttp3.Headers
import okhttp3.HttpUrl

class CookieStore {
    private val jar = ArrayList<Cookie>()

    @Synchronized
    fun header(url: HttpUrl): String? {
        val now = System.currentTimeMillis()
        jar.removeAll { it.expiresAt < now }
        val hits = jar.filter { it.matches(url) }
            .sortedByDescending { it.path.length }
        if (hits.isEmpty()) return null
        return hits.joinToString("; ") { it.name + "=" + it.value }
    }

    @Synchronized
    fun save(url: HttpUrl, headers: Headers) {
        val now = System.currentTimeMillis()
        for (c in Cookie.parseAll(url, headers)) {
            if (c.name.length + c.value.length > MAX_COOKIE_BYTES) continue
            jar.removeAll { it.name == c.name && it.domain == c.domain && it.path == c.path }
            if (c.expiresAt < now) continue
            jar.add(c)
            if (jar.size > MAX_COOKIES) jar.removeAt(0)
        }
    }

    private companion object {
        const val MAX_COOKIES = 100
        const val MAX_COOKIE_BYTES = 4096
    }
}
