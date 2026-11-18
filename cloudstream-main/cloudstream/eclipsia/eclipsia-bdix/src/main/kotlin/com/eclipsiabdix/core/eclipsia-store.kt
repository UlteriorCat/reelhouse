package com.eclipsiabdix

import com.eclipsia.core.store.PluginStore
import com.eclipsia.core.store.StoreContract

object EclipsiaStore : PluginStore("eclipsia_bdix", "EclipsiaBDIX", BuildConfig.TMDB_DEFAULT_KEY), StoreContract {
    override val hideLabels: Boolean get() = false

    override fun tmdbKey(): String = defaultTmdbKey

    fun isEnabled(scraperId: String, default: Boolean = true): Boolean =
        prefs.getBoolean("enabled_$scraperId", default)
}
