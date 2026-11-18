package com.eclipsia.core.net

import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.Call
import okhttp3.Callback
import okhttp3.CookieJar
import okhttp3.Dns
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Response
import java.io.IOException
import java.net.InetAddress
import java.net.Proxy
import java.net.UnknownHostException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resumeWithException

object NetPolicy {
    private class SafeDns(private val delegate: Dns) : Dns {
        override fun lookup(hostname: String): List<InetAddress> {
            val allowed = delegate.lookup(hostname).filterNot { AddressPolicy.isBlocked(it) }
            if (allowed.isEmpty()) throw UnknownHostException(hostname)
            return allowed
        }
    }

    private val literalGuard = Interceptor { chain ->
        val request = chain.request()
        if (!AddressPolicy.literalAllowed(request.url.host)) throw IOException("blocked")
        chain.proceed(request)
    }

    private val CROSS_HOST_HEADERS = setOf(
        "host", "connection", "accept-encoding", "content-length", "transfer-encoding", "content-type",
        "accept", "accept-language", "user-agent", "referer", "range",
    )

    private val redirectGuard = Interceptor { chain ->
        val request = chain.request()
        val origin = chain.call().request().url
        val url = request.url
        if (origin.isHttps && !url.isHttps) throw IOException("blocked")
        if (url.host == origin.host) {
            chain.proceed(request)
        } else {
            val builder = request.newBuilder()
            for (name in request.headers.names()) {
                if (name.lowercase() !in CROSS_HOST_HEADERS) builder.removeHeader(name)
            }
            chain.proceed(builder.build())
        }
    }

    fun client(base: OkHttpClient, followRedirects: Boolean): OkHttpClient =
        base.newBuilder()
            .cookieJar(CookieJar.NO_COOKIES)
            .proxy(Proxy.NO_PROXY)
            .dns(SafeDns(base.dns))
            .followRedirects(followRedirects)
            .followSslRedirects(followRedirects)
            .addNetworkInterceptor(literalGuard)
            .apply { if (followRedirects) addNetworkInterceptor(redirectGuard) }
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .writeTimeout(20, TimeUnit.SECONDS)
            .callTimeout(30, TimeUnit.SECONDS)
            .build()
}

internal suspend fun <T> Call.readWith(block: (Response) -> T): T =
    suspendCancellableCoroutine { cont ->
        cont.invokeOnCancellation { cancel() }
        enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                if (cont.isActive) cont.resumeWithException(e)
            }

            override fun onResponse(call: Call, response: Response) {
                val outcome = try {
                    Result.success(response.use(block))
                } catch (t: Throwable) {
                    Result.failure(t)
                }
                if (cont.isActive) cont.resumeWith(outcome)
            }
        })
    }
