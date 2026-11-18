package com.eclipsia.core.play

import android.util.Base64
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.UUID
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

object LocalServer {
    private const val MAX_ENTRIES = 512
    private const val MAX_TOTAL_BYTES = 32L * 1024 * 1024
    private const val TTL_MS = 6L * 60 * 60 * 1000
    private const val MAX_LINE = 4096
    private const val MAX_HEADERS = 64
    private const val PLAYLIST_MIME = "application/vnd.apple.mpegurl"

    private class Entry(val bytes: ByteArray, val at: Long)

    private val store = LinkedHashMap<String, Entry>()
    private var totalBytes = 0L

    private val pool = ThreadPoolExecutor(
        2, 8, 30L, TimeUnit.SECONDS, LinkedBlockingQueue(64),
        { r -> Thread(r, "eclipsia-local").apply { isDaemon = true } },
        ThreadPoolExecutor.AbortPolicy(),
    ).apply { allowCoreThreadTimeOut(true) }

    @Volatile
    private var server: ServerSocket? = null

    private fun evict(now: Long) {
        val it = store.entries.iterator()
        while (it.hasNext()) {
            val e = it.next()
            val expired = now - e.value.at > TTL_MS
            if (!expired && store.size <= MAX_ENTRIES && totalBytes <= MAX_TOTAL_BYTES) break
            totalBytes -= e.value.bytes.size
            it.remove()
        }
    }

    fun publish(playlist: String): String {
        val id = UUID.randomUUID().toString().replace("-", "")
        val bytes = playlist.toByteArray(Charsets.UTF_8)
        if (bytes.size > MAX_TOTAL_BYTES) throw IllegalArgumentException()
        val now = System.currentTimeMillis()
        synchronized(store) {
            store[id] = Entry(bytes, now)
            totalBytes += bytes.size
            evict(now)
        }
        return "http://127.0.0.1:${ensureStarted().localPort}/$id.m3u8"
    }

    private val nestedUri = Regex("URI=\"(data:[^\"]+)\"", RegexOption.IGNORE_CASE)

    private fun decodeNested(url: String): String? {
        val payload = DataUrls.parsePlaylist(url) ?: return null
        val text = runCatching {
            if (payload.base64) String(Base64.decode(payload.data, Base64.DEFAULT), Charsets.UTF_8)
            else DataUrls.decodePlain(payload.data)
        }.getOrNull() ?: return null
        return text.takeIf { it.trimStart().startsWith("#EXTM3U") }
    }

    fun publishResolved(playlist: String, depth: Int = 0): String {
        val resolved = if (depth >= 2) playlist else playlist.lines().joinToString("\n") { line ->
            when {
                line.trimStart().startsWith("data:", ignoreCase = true) ->
                    decodeNested(line.trim())?.let { publishResolved(it, depth + 1) } ?: line
                line.contains("URI=\"data:", ignoreCase = true) ->
                    nestedUri.replace(line) { m ->
                        decodeNested(m.groupValues[1])?.let { "URI=\"${publishResolved(it, depth + 1)}\"" } ?: m.value
                    }
                else -> line
            }
        }
        return publish(resolved)
    }

    @Synchronized
    private fun ensureStarted(): ServerSocket {
        server?.takeIf { !it.isClosed }?.let { return it }
        val s = ServerSocket(0, 16, InetAddress.getByName("127.0.0.1"))
        server = s
        Thread({
            while (!s.isClosed) {
                val client = try {
                    s.accept()
                } catch (_: Exception) {
                    break
                }
                try {
                    pool.execute { runCatching { handle(client) } }
                } catch (_: RejectedExecutionException) {
                    runCatching { client.close() }
                }
            }
        }, "eclipsia-local-accept").apply { isDaemon = true }.start()
        return s
    }

    private fun readLine(input: InputStream): String? {
        val out = ByteArrayOutputStream()
        while (true) {
            val c = input.read()
            if (c < 0) return if (out.size() == 0) null else out.toString(Charsets.ISO_8859_1.name())
            if (c == '\n'.code) return out.toString(Charsets.ISO_8859_1.name())
            if (c == '\r'.code) continue
            if (out.size() >= MAX_LINE) throw IOException()
            out.write(c)
        }
    }

    private fun handle(client: Socket) {
        client.use { sock ->
            sock.soTimeout = 10_000
            val input = BufferedInputStream(sock.getInputStream(), 2048)
            val requestLine = readLine(input) ?: return@use
            var headerCount = 0
            while (true) {
                val h = readLine(input) ?: break
                if (h.isEmpty()) break
                if (++headerCount > MAX_HEADERS) throw IOException()
            }
            val parts = requestLine.split(' ')
            val method = parts.getOrNull(0)
            val id = parts.getOrNull(1)?.substringBefore('?')?.trim('/')?.substringBefore('.')
            val body = id?.let { key -> synchronized(store) { store[key]?.bytes } }

            val out = sock.getOutputStream()
            if (body == null || (method != "GET" && method != "HEAD")) {
                out.write("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray())
            } else {
                out.write(
                    ("HTTP/1.1 200 OK\r\nContent-Type: $PLAYLIST_MIME\r\nCache-Control: no-store\r\n" +
                        "Content-Length: ${body.size}\r\nConnection: close\r\n\r\n").toByteArray()
                )
                if (method == "GET") out.write(body)
            }
            out.flush()
        }
    }
}
