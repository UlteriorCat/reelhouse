package com.eclipsiabdix

import com.eclipsia.core.Memo
import com.eclipsia.core.js.ScraperRef
import org.json.JSONObject

data class EclipsiaScraper(
    val id: String,
    val name: String,
    val description: String?,
    val version: String,
    val supportedTypes: Set<String>,
    val defaultEnabled: Boolean,
)

object EclipsiaRepository {
    const val REPO_URL = "bundled"
    private const val DIR = "scrapers"

    private val scraperList = Memo<List<EclipsiaScraper>> load@{
        val text = EclipsiaEngine.assets.readText("manifest.json") ?: return@load null
        val root = runCatching { JSONObject(text) }.getOrNull() ?: return@load null
        val arr = root.optJSONArray("scrapers") ?: return@load null
        (0 until arr.length()).mapNotNull { i ->
            val m = arr.optJSONObject(i) ?: return@mapNotNull null
            val key = m.optString("id").takeIf { it.isNotBlank() } ?: return@mapNotNull null
            EclipsiaEngine.integrity.readVerified("$DIR/$key.js") ?: return@mapNotNull null
            val typesArr = m.optJSONArray("supportedTypes")
            val types = (0 until (typesArr?.length() ?: 0))
                .map { typesArr?.optString(it).orEmpty().let { t -> if (t == "series") "tv" else t } }
                .toSet().ifEmpty { setOf("movie", "tv") }
            EclipsiaScraper(
                id = "$REPO_URL:$key",
                name = m.optString("name").trim().trimEnd('.').ifBlank { key },
                description = m.optString("description").takeIf { it.isNotBlank() },
                version = m.optString("version", "1"),
                supportedTypes = types,
                defaultEnabled = m.optBoolean("enabled", true),
            )
        }.takeIf { it.isNotEmpty() }
    }

    private val scrapers: List<EclipsiaScraper> get() = scraperList.get().orEmpty()

    fun allScrapers(): List<EclipsiaScraper> = scrapers

    fun active(mediaType: String): List<EclipsiaScraper> = scrapers.filter {
        EclipsiaStore.isEnabled(it.id, it.defaultEnabled) && mediaType in it.supportedTypes
    }

    fun effectiveConcurrency(): Int =
        if (EclipsiaStore.concurrencyAuto) enabledCount().coerceAtLeast(1) else EclipsiaStore.concurrency

    private fun enabledCount(): Int = scrapers.count { EclipsiaStore.isEnabled(it.id, it.defaultEnabled) }

    fun ref(s: EclipsiaScraper): ScraperRef {
        val key = s.id.substringAfter(':')
        return ScraperRef(key, "$DIR/$key.js")
    }
}
