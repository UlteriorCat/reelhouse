package com.eclipsia.core.source

import com.eclipsia.core.Memo
import com.eclipsia.core.js.AssetReader
import org.json.JSONObject
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap

class SourceIntegrity(private val assets: AssetReader, private val lockPath: String = "sources.lock.json") {
    private val hashes = Memo<Map<String, String>> {
        val text = assets.readText(lockPath)
        val files = text?.let { runCatching { JSONObject(it).optJSONObject("files") }.getOrNull() }
        files?.keys()?.asSequence()?.associateWith { files.optString(it).lowercase() }?.takeIf { it.isNotEmpty() }
    }

    private val verified = ConcurrentHashMap<String, String>()

    fun readVerified(path: String): String? {
        verified[path]?.let { return it }
        val expected = hashes.get()?.get(path) ?: return null
        val bytes = assets.readBytes(path) ?: return null
        if (sha256(bytes) != expected) return null
        val text = bytes.toString(Charsets.UTF_8)
        return verified.putIfAbsent(path, text) ?: text
    }

    companion object {
        fun sha256(bytes: ByteArray): String =
            MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    }
}
