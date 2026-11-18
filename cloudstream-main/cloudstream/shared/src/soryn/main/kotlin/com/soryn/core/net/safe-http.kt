package com.soryn.core.net

import android.util.Base64
import com.soryn.core.play.HeaderRules
import com.lagradost.cloudstream3.app
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

class HttpBudget(
    private val maxRequests: Int = DEFAULT_MAX_REQUESTS,
    private val maxTotalBytes: Long = DEFAULT_MAX_TOTAL_BYTES,
) {
    companion object {
        const val DEFAULT_MAX_REQUESTS = 250
        const val DEFAULT_MAX_TOTAL_BYTES = 64L * 1024 * 1024
    }

    private val requests = AtomicInteger(0)
    private val bytes = AtomicLong(0)

    fun tryStartRequest(): Boolean = requests.incrementAndGet() <= maxRequests
    fun addBytes(n: Long): Boolean = bytes.addAndGet(n) <= maxTotalBytes
}

object SafeHttp {
    const val DEFAULT_UA =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36"
    private const val MAX_BODY_BYTES = 4 * 1_048_576
    private const val MAX_HEADER_CHARS = 8 * 1024
    private const val MAX_REDIRECTS = 10
    private const val GLOBAL_IN_FLIGHT = 24
    private const val TRUNCATED = "\n...[truncated]"
    private val METHODS = setOf("GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")
    private val REDIRECT_SAFE_HEADERS = setOf("accept", "accept-language", "user-agent", "referer", "content-type")
    private val REDIRECT_CODES = setOf(301, 302, 303, 307, 308)

    private val gate = Semaphore(GLOBAL_IN_FLIGHT)

    private val client: OkHttpClient by lazy { NetPolicy.client(app.baseClient, followRedirects = false) }

    private class Raw(
        val code: Int,
        val message: String,
        val finalUrl: String,
        val headers: JSONObject,
        val bytes: ByteArray,
        val truncated: Boolean,
        val charset: String,
        val location: String?,
        val base: HttpUrl,
    )

    private suspend fun send(request: Request, cookies: CookieStore?): Raw =
        client.newCall(request).readWith { resp ->
            cookies?.save(resp.request.url, resp.headers)
            var truncated = false
            val bytes: ByteArray = resp.body.let { rb ->
                val source = rb.source()
                source.request((MAX_BODY_BYTES + 1).toLong())
                truncated = source.buffer.size > MAX_BODY_BYTES
                source.buffer.readByteArray(minOf(source.buffer.size, MAX_BODY_BYTES.toLong()))
            }

            val out = JSONObject()
            for (name in resp.headers.names()) {
                var joined = resp.headers.values(name).joinToString(",")
                if (joined.length > MAX_HEADER_CHARS) joined = joined.take(MAX_HEADER_CHARS) + TRUNCATED
                out.put(name.lowercase(), joined)
            }
            Raw(
                resp.code, resp.message, resp.request.url.toString(), out, bytes, truncated,
                resp.body.contentType()?.charset()?.name() ?: "utf-8",
                resp.header("Location"), resp.request.url,
            )
        }

    private fun failure(url: String, why: String): String =
        JSONObject()
            .put("status", 0)
            .put("statusText", why)
            .put("url", url)
            .put("headers", JSONObject())
            .put("b64", "")
            .put("charset", "utf-8")
            .put("truncated", false)
            .toString()

    private fun String.toHttpUrlOrNullSafe(): HttpUrl? {
        val trimmed = trim()
        val lower = trimmed.lowercase()
        if (!lower.startsWith("http://") && !lower.startsWith("https://")) return null
        return trimmed.toHttpUrlOrNull()
    }

    suspend fun execute(
        budget: HttpBudget,
        url: String,
        method: String,
        headersJson: String,
        bodyB64: String,
        hasBody: Boolean,
        follow: Boolean,
        cookies: CookieStore? = null,
    ): String {
        var shown = ""
        try {
            var current = url.toHttpUrlOrNullSafe() ?: return failure("", "request failed")
            shown = current.toString()

            var m = method.uppercase()
            if (m !in METHODS) return failure(shown, "request failed")

            val headers = LinkedHashMap<String, String>()
            val parsedHeaders = JSONObject(headersJson)
            var hasUserAgent = false
            var contentType: String? = null
            for (key in parsedHeaders.keys()) {
                val value = parsedHeaders.optString(key)
                if (key.equals("host", true) || HeaderRules.isRequestForbidden(key)) continue
                if (!HeaderRules.isValid(key, value)) continue
                if (key.equals("content-type", true)) contentType = value
                if (key.equals("user-agent", true)) hasUserAgent = true
                headers[key] = value
            }
            if (!hasUserAgent) headers["User-Agent"] = DEFAULT_UA

            var bodyBytes: ByteArray? =
                if (m == "GET" || m == "HEAD") null
                else if (hasBody) Base64.decode(bodyB64, Base64.DEFAULT) else ByteArray(0)

            var hops = 0
            while (true) {
                if (!AddressPolicy.literalAllowed(current.host)) return failure(current.toString(), "request failed")
                if (!budget.tryStartRequest()) return failure(current.toString(), "request quota exceeded")

                val builder = Request.Builder().url(current)
                for ((k, v) in headers) builder.header(k, v)
                if (cookies != null && headers.keys.none { it.equals("cookie", true) }) {
                    cookies.header(current)?.let { builder.header("Cookie", it) }
                }
                val body = bodyBytes?.let {
                    val type = contentType
                        ?: if (m == "POST") "application/x-www-form-urlencoded" else "application/json"
                    it.toRequestBody(type.toMediaTypeOrNull())
                }
                builder.method(m, body)

                val raw = gate.withPermit { send(builder.build(), cookies) }
                if (!budget.addBytes(raw.bytes.size.toLong())) return failure(current.toString(), "byte quota exceeded")

                if (follow && raw.code in REDIRECT_CODES && raw.location != null) {
                    if (++hops > MAX_REDIRECTS) return failure(current.toString(), "too many redirects")
                    val next = raw.base.resolve(raw.location)
                    if (next == null || (next.scheme != "http" && next.scheme != "https")) {
                        return failure(current.toString(), "request failed")
                    }
                    if (current.isHttps && !next.isHttps) return failure(current.toString(), "request failed")
                    if (next.host != current.host) {
                        headers.keys.removeAll { it.lowercase() !in REDIRECT_SAFE_HEADERS }
                    }
                    if (raw.code == 303 || ((raw.code == 301 || raw.code == 302) && m == "POST")) {
                        m = "GET"
                        bodyBytes = null
                        contentType = null
                        headers.keys.removeAll { it.equals("content-type", true) }
                    }
                    current = next
                    continue
                }

                return JSONObject()
                    .put("status", raw.code)
                    .put("statusText", raw.message)
                    .put("url", raw.finalUrl)
                    .put("headers", raw.headers)
                    .put("b64", Base64.encodeToString(raw.bytes, Base64.NO_WRAP))
                    .put("charset", raw.charset)
                    .put("truncated", raw.truncated)
                    .toString()
            }
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            return failure(shown, "request failed")
        }
    }
}
