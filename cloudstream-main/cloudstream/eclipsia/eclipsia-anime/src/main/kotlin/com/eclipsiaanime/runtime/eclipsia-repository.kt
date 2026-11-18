package com.eclipsiaanime

import com.eclipsia.core.Memo
import com.eclipsia.core.js.ScraperRef
import org.json.JSONArray
import org.json.JSONObject

data class EclipsiaScraper(
    val id: String,
    val name: String,
    val description: String?,
    val version: String,
    val supportedTypes: Set<String>,
    val manifestEnabled: Boolean,
    val defaultEnabled: Boolean,
    val hasSettings: Boolean,
)

object EclipsiaRepository {
    const val REPO_URL = "bundled"
    private const val DIR = "scrapers"

    private fun json(path: String): String? = EclipsiaEngine.assets.readText(path)

    private val defaultIds = Memo<Set<String>> load@{
        val text = json("default-providers.json") ?: return@load null
        val ids: JSONArray = runCatching {
            if (text.trimStart().startsWith("[")) JSONArray(text) else JSONObject(text).optJSONArray("enabled")
        }.getOrNull() ?: return@load null
        (0 until ids.length()).map { ids.optString(it) }.toSet().ifEmpty { null }
    }

    private fun splitDescription(desc: String): Pair<String, String> {
        val cleaned = desc.replace(Regex("^\\s*provider\\s*:\\s*", RegexOption.IGNORE_CASE), "")
        val parts = cleaned.split('•', '|').map { it.trim() }.filter { it.isNotEmpty() }
        return if (parts.isEmpty()) "" to "" else parts.first() to parts.drop(1).joinToString(" • ")
    }

    private val scraperList = Memo<List<EclipsiaScraper>> load@{
        val root = json("manifest.json")?.let { runCatching { JSONObject(it) }.getOrNull() } ?: return@load null
        val arr = root.optJSONArray("scrapers") ?: return@load null
        val defaults = defaultIds.get()
        (0 until arr.length()).mapNotNull { i ->
            val m = arr.optJSONObject(i) ?: return@mapNotNull null
            val key = m.optString("id").takeIf { it.isNotBlank() } ?: return@mapNotNull null
            val code = EclipsiaEngine.integrity.readVerified("$DIR/$key.js") ?: return@mapNotNull null
            val (name, sub) = splitDescription(m.optString("description"))
            val typesArr = m.optJSONArray("supportedTypes")
            val types = (0 until (typesArr?.length() ?: 0))
                .map { typesArr?.optString(it).orEmpty().let { t -> if (t == "series") "tv" else t } }
                .toSet().ifEmpty { setOf("movie", "tv") }
            val enabledByManifest = m.optBoolean("defaultEnabled", m.optBoolean("enabled", true))
            EclipsiaScraper(
                id = "$REPO_URL:$key",
                name = name.ifBlank { key.replaceFirstChar { it.uppercase() } },
                description = sub.ifBlank { null },
                version = m.optString("version", "1"),
                supportedTypes = types,
                manifestEnabled = true,
                defaultEnabled = defaults?.contains(key) ?: enabledByManifest,
                hasSettings = if (m.has("hasSettings")) m.optBoolean("hasSettings") else code.contains("onSettings"),
            )
        }.takeIf { it.isNotEmpty() }
    }

    private val scrapers: List<EclipsiaScraper> get() = scraperList.get().orEmpty()

    fun allScrapers(): List<EclipsiaScraper> = scrapers.sortedBy { it.name.lowercase() }

    fun active(mediaType: String): List<EclipsiaScraper> = scrapers.filter {
        EclipsiaStore.isEnabled(it.id, it.manifestEnabled, it.defaultEnabled) && mediaType in it.supportedTypes
    }

    fun effectiveConcurrency(): Int =
        if (EclipsiaStore.concurrencyAuto) enabledCount().coerceAtLeast(1) else EclipsiaStore.concurrency

    private fun enabledCount(): Int = scrapers.count {
        EclipsiaStore.isEnabled(it.id, it.manifestEnabled, it.defaultEnabled)
    }

    fun ref(s: EclipsiaScraper): ScraperRef {
        val key = s.id.substringAfter(':')
        return ScraperRef(key, "$DIR/$key.js")
    }
}
