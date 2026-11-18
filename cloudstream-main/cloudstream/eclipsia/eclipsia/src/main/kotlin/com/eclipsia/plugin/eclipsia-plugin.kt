package com.eclipsia

import android.content.Context
import com.eclipsia.core.catalog.EclipsiaIMDbApi
import com.eclipsia.core.catalog.EclipsiaPosters
import com.eclipsia.core.catalog.EclipsiaTmdb
import com.lagradost.cloudstream3.plugins.CloudstreamPlugin
import com.lagradost.cloudstream3.plugins.Plugin

@CloudstreamPlugin
class EclipsiaPlugin : Plugin() {
    override fun load(context: Context) {
        EclipsiaEngine.plugin = this
        EclipsiaStore.init(context.applicationContext)
        EclipsiaTmdb.init(EclipsiaStore)
        EclipsiaPosters.init(EclipsiaStore, "eclipsia_imdb_ids")
        EclipsiaIMDbApi.init(
            order = { EclipsiaStore.rowOrder("imdb", it) },
            enabled = { EclipsiaStore.catalogRowEnabled(it) },
        )
        if (EclipsiaStore.tmdbEnabled) registerMainAPI(EclipsiaProvider())
        val anyCatalog = EclipsiaStore.tmdbEnabled || EclipsiaStore.imdbEnabled
        if (EclipsiaStore.imdbEnabled || !anyCatalog) registerMainAPI(EclipsiaIMDbProvider())

        openSettings = { ctx -> EclipsiaSettingsUi.show(ctx) }
    }
}
