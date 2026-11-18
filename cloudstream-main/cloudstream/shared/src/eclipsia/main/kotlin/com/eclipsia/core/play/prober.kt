package com.eclipsia.core.play

import com.eclipsia.core.net.AddressPolicy
import com.eclipsia.core.net.NetPolicy
import com.eclipsia.core.net.SafeHttp
import com.eclipsia.core.net.readWith
import com.lagradost.cloudstream3.app
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit

object Prober {
    data class Result(val kind: MediaKind?, val height: Int?, val dead: Boolean = false, val sure: Boolean = false)

    private const val HEAD_BYTES = 32L * 1024
    private val gate = Semaphore(16)
    private val RETRY_WITHOUT_RANGE = setOf(400, 401, 403, 405, 416, 501)

    private val client: OkHttpClient by lazy {
        NetPolicy.client(app.baseClient, followRedirects = true).newBuilder()
            .connectTimeout(6, TimeUnit.SECONDS)
            .readTimeout(8, TimeUnit.SECONDS)
            .callTimeout(10, TimeUnit.SECONDS)
            .build()
    }

    suspend fun probe(url: String, headers: Map<String, String>): Result? {
        val parsed = url.trim().toHttpUrlOrNull() ?: return null
        if (!AddressPolicy.literalAllowed(parsed.host)) return Result(null, null, dead = true)
        return gate.withPermit {
            try {
                run(parsed.toString(), headers)
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                null
            }
        }
    }

    private fun request(url: String, headers: Map<String, String>, ranged: Boolean): Request {
        val builder = Request.Builder().url(url)
        for ((k, v) in headers) if (HeaderRules.isValid(k, v)) builder.header(k, v)
        if (HeaderRules.find(headers, "user-agent") == null) builder.header("User-Agent", SafeHttp.DEFAULT_UA)
        if (ranged) builder.header("Range", "bytes=0-${HEAD_BYTES - 1}")
        return builder.build()
    }

    private suspend fun run(url: String, headers: Map<String, String>): Result? {
        val first = attempt(url, headers, ranged = true)
        if (first.second != null) return first.second
        if (first.first in RETRY_WITHOUT_RANGE) {
            val second = attempt(url, headers, ranged = false)
            if (second.second != null) return second.second
            return if (second.first == 404 || second.first == 410) Result(null, null, dead = true) else null
        }
        return if (first.first == 404 || first.first == 410) Result(null, null, dead = true) else null
    }

    private suspend fun attempt(url: String, headers: Map<String, String>, ranged: Boolean): Pair<Int, Result?> =
        client.newCall(request(url, headers, ranged)).readWith { resp ->
            if (resp.code !in 200..299) return@readWith resp.code to null
            val source = resp.body.source()
            source.request(HEAD_BYTES)
            val head = source.buffer.readByteArray(minOf(source.buffer.size, HEAD_BYTES))
            if (head.isEmpty()) return@readWith resp.code to Result(null, null, dead = true)

            val contentType = resp.header("Content-Type")
            val fromBytes = MediaKinds.fromBytes(head)
            val height = if (fromBytes == MediaKind.HLS) MediaKinds.maxHlsHeight(String(head, Charsets.UTF_8)) else null
            if (fromBytes != null) return@readWith resp.code to Result(fromBytes, height, sure = true)

            val ct = contentType?.substringBefore(';')?.trim()?.lowercase().orEmpty()
            val kindByHeader = MediaKinds.fromContentType(contentType)
            if (kindByHeader != null) return@readWith resp.code to Result(kindByHeader, null)
            if (ct.startsWith("text/") || ct.contains("html") || ct.contains("json") || ct.contains("xml")) {
                return@readWith resp.code to Result(null, null, dead = true)
            }
            resp.code to Result(MediaKinds.fromUrl(resp.request.url.toString()), null)
        }
}
