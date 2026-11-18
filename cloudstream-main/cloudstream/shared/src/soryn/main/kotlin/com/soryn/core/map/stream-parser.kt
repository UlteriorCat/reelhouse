package com.soryn.core.map

import com.soryn.core.play.HeaderRules
import org.json.JSONArray
import org.json.JSONObject

data class JsSubtitle(
    val url: String,
    val language: String,
    val name: String?,
    val headers: Map<String, String>,
)

data class JsStream(
    val url: String,
    val title: String?,
    val name: String?,
    val quality: String?,
    val size: String?,
    val language: String?,
    val type: String?,
    val headers: Map<String, String>,
    val subtitles: List<JsSubtitle>,
) {
    companion object {

        private const val MAX_RAW_CHARS = 8 * 1024 * 1024
        private const val MAX_STREAMS = 300
        private const val MAX_FIELD_CHARS = 4096
        private const val MAX_HEADERS = 64
        private const val MAX_SUBTITLES = 100

        fun parseList(raw: String): List<JsStream> {
            if (raw.length > MAX_RAW_CHARS) return emptyList()
            val arr = runCatching { JSONArray(raw) }.getOrNull() ?: return emptyList()
            return (0 until minOf(arr.length(), MAX_STREAMS)).mapNotNull {
                runCatching { parse(arr.optJSONObject(it)) }.getOrNull()
            }
        }

        private fun JSONObject.str(key: String): String? {
            val v = opt(key)
            if (v !is String && v !is Number && v !is Boolean) return null
            val s = v.toString().trim()
            return s.takeIf { it.isNotEmpty() && !it.contains("[object") }?.take(MAX_FIELD_CHARS)
        }

        private fun JSONObject.headerMap(key: String): Map<String, String> {
            val o = optJSONObject(key) ?: return emptyMap()
            val raw = LinkedHashMap<String, String>()
            for (k in o.keys()) {
                if (raw.size >= MAX_HEADERS) break
                val v = o.opt(k)
                if (v !is String && v !is Number && v !is Boolean) continue
                raw[k] = v.toString()
            }
            return HeaderRules.sanitize(raw)
        }

        private fun parse(o: JSONObject?): JsStream? {
            o ?: return null

            val rawUrl = o.opt("url")
            val url0: String = if (rawUrl is String) {
                rawUrl
            } else if (rawUrl is JSONObject) {
                rawUrl.optString("url")
            } else {
                ""
            }
            val url = HeaderRules.normalizeUrl(url0) ?: return null

            val subs = o.optJSONArray("subtitles")?.let { a ->
                (0 until minOf(a.length(), MAX_SUBTITLES)).mapNotNull { i ->
                    val s = a.optJSONObject(i) ?: return@mapNotNull null
                    val su = HeaderRules.normalizeUrl(s.str("url") ?: return@mapNotNull null) ?: return@mapNotNull null
                    JsSubtitle(su, s.str("language") ?: "Unknown", s.str("name"), s.headerMap("headers"))
                }
            } ?: emptyList()

            return JsStream(
                url = url,
                title = o.str("title"),
                name = o.str("name"),
                quality = o.str("quality"),
                size = o.str("size"),
                language = o.str("language"),
                type = o.str("type")?.lowercase(),
                headers = o.headerMap("headers"),
                subtitles = subs,
            )
        }
    }
}
