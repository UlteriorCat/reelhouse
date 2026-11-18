package com.eclipsia.core.store

abstract class ScraperPluginStore(prefsName: String, label: String, defaultTmdbKey: String) :
    PluginStore(prefsName, label, defaultTmdbKey), StoreContract {
    fun isEnabled(scraperId: String, manifestEnabled: Boolean, defaultEnabled: Boolean = manifestEnabled): Boolean =
        manifestEnabled && prefs.getBoolean("enabled_$scraperId", defaultEnabled)

    fun settingsJson(scraperId: String): String = prefs.getString("settings_$scraperId", null) ?: "{}"
    fun saveSettings(scraperId: String, json: String) {
        prefs.edit().putString("settings_$scraperId", json).apply()
    }

    var tmdbKeyOverride: String
        get() = prefs.getString("tmdb_key", "") ?: ""
        set(value) {
            prefs.edit().putString("tmdb_key", value.trim()).apply()
        }

    var tmdbPersonalEnabled: Boolean
        get() = prefs.getBoolean("tmdb_personal", false)
        set(value) {
            prefs.edit().putBoolean("tmdb_personal", value).apply()
        }

    val MAX_STREAM_CAP = 100

    var totalCap: Int
        get() = prefs.getInt("cap_total", 0).coerceIn(0, MAX_STREAM_CAP)
        set(value) {
            prefs.edit().putInt("cap_total", value.coerceIn(0, MAX_STREAM_CAP)).apply()
        }

    var perProviderCapEnabled: Boolean
        get() = prefs.getBoolean("cap_per_provider", false)
        set(value) {
            prefs.edit().putBoolean("cap_per_provider", value).apply()
        }

    fun providerCap(scraperId: String): Int =
        prefs.getInt("cap_provider_$scraperId", 0).coerceIn(0, MAX_STREAM_CAP)

    fun setProviderCap(scraperId: String, value: Int) {
        prefs.edit().putInt("cap_provider_$scraperId", value.coerceIn(0, MAX_STREAM_CAP)).apply()
    }

    fun catalogRowEnabled(title: String, default: Boolean = true): Boolean =
        prefs.getBoolean("catalog_row_$title", default)

    fun rowOrder(group: String, defaults: List<String>): List<String> {
        val saved = (prefs.getString("row_order_$group", "") ?: "").split("|").filter { it in defaults }.distinct()
        return saved + defaults.filter { it !in saved }
    }

    fun setRowOrder(group: String, keys: List<String>) {
        prefs.edit().putString("row_order_$group", keys.joinToString("|")).apply()
    }

    fun setCatalogRowEnabled(title: String, enabled: Boolean) {
        prefs.edit().putBoolean("catalog_row_$title", enabled).apply()
    }

    override var hideLabels: Boolean
        get() = prefs.getBoolean("hide_labels", false)
        set(value) {
            prefs.edit().putBoolean("hide_labels", value).apply()
        }

    override fun tmdbKey(): String {
        val custom = tmdbKeyOverride
        return if (tmdbPersonalEnabled && custom.isNotBlank()) custom else defaultTmdbKey
    }

    val DEFAULT_LANGUAGE = "en-US"

    private val LANGUAGE_RE = Regex("^[a-z]{2}(-[A-Z]{2})?$")

    var language: String
        get() = prefs.getString("catalog_language", DEFAULT_LANGUAGE)?.takeIf { LANGUAGE_RE.matches(it) } ?: DEFAULT_LANGUAGE
        set(value) {
            val v = value.trim().let { raw ->
                raw.substringBefore('-').lowercase() + (raw.substringAfter('-', "").takeIf { it.isNotEmpty() }?.let { "-" + it.uppercase() } ?: "")
            }
            prefs.edit().putString("catalog_language", v.takeIf { LANGUAGE_RE.matches(it) } ?: DEFAULT_LANGUAGE).apply()
        }

    val languageCode: String get() = language.substringBefore('-')
}
