package com.eclipsiaanime

import com.eclipsia.core.store.ScraperPluginStore

object EclipsiaStore : ScraperPluginStore("eclipsia_anime", "Eclipsia Anime", BuildConfig.TMDB_DEFAULT_KEY) {
    var kitsuEnabled: Boolean
        get() = prefs.getBoolean("kitsu_enabled", true)
        set(value) {
            prefs.edit().putBoolean("kitsu_enabled", value).apply()
        }

    var anilistEnabled: Boolean
        get() = prefs.getBoolean("anilist_enabled", true)
        set(value) {
            prefs.edit().putBoolean("anilist_enabled", value).apply()
        }

    var langEnglish: Boolean
        get() = prefs.getBoolean("lang_english", false)
        set(value) {
            prefs.edit().putBoolean("lang_english", value).apply()
        }

    var langMultiDub: Boolean
        get() = prefs.getBoolean("lang_multidub", false)
        set(value) {
            prefs.edit().putBoolean("lang_multidub", value).apply()
        }

    var langJapanese: Boolean
        get() = prefs.getBoolean("lang_japanese", false)
        set(value) {
            prefs.edit().putBoolean("lang_japanese", value).apply()
        }

}
