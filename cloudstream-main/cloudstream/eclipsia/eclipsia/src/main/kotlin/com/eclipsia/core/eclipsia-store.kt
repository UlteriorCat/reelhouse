package com.eclipsia

import com.eclipsia.core.store.ScraperPluginStore

object EclipsiaStore : ScraperPluginStore("eclipsia", "Eclipsia", BuildConfig.TMDB_DEFAULT_KEY) {
    const val SOURCE_NUVIO = "nuvio"
    const val SOURCE_TMDB = "tmdb"

    var catalogSource: String
        get() = prefs.getString("catalog_source", SOURCE_NUVIO)?.takeIf { it == SOURCE_NUVIO || it == SOURCE_TMDB } ?: SOURCE_NUVIO
        set(value) {
            prefs.edit().putString("catalog_source", if (value == SOURCE_TMDB) SOURCE_TMDB else SOURCE_NUVIO).apply()
        }

    var tmdbEnabled: Boolean
        get() = prefs.getBoolean("tmdb_enabled", true)
        set(value) {
            prefs.edit().putBoolean("tmdb_enabled", value).apply()
        }

    var imdbEnabled: Boolean
        get() = prefs.getBoolean("imdb_enabled", true)
        set(value) {
            prefs.edit().putBoolean("imdb_enabled", value).apply()
        }

    const val DEFAULT_REGION = "US"
    const val DEFAULT_EXCLUDED_KEYWORDS = "190370|13059|226161|195669"

    private val REGION_RE = Regex("^[A-Z]{2}$")

    var region: String
        get() = prefs.getString("catalog_region", DEFAULT_REGION)?.takeIf { REGION_RE.matches(it) } ?: DEFAULT_REGION
        set(value) {
            prefs.edit().putString("catalog_region", value.trim().uppercase().takeIf { REGION_RE.matches(it) } ?: DEFAULT_REGION).apply()
        }

    var excludedKeywords: String
        get() = prefs.getString("catalog_excluded", DEFAULT_EXCLUDED_KEYWORDS) ?: DEFAULT_EXCLUDED_KEYWORDS
        set(value) {
            val ids = value.split('|', ',', ' ', ';').map { it.trim() }.filter { it.isNotEmpty() && it.all(Char::isDigit) }
            prefs.edit().putString("catalog_excluded", ids.distinct().joinToString("|")).apply()
        }
}
