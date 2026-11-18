package com.eclipsiaanime

import android.content.Context
import com.eclipsia.core.catalog.EclipsiaPosters
import com.eclipsia.core.catalog.EclipsiaTmdb
import com.lagradost.cloudstream3.plugins.CloudstreamPlugin
import com.lagradost.cloudstream3.plugins.Plugin

@CloudstreamPlugin
class EclipsiaAnimePlugin : Plugin() {
    override fun load(context: Context) {
        EclipsiaEngine.plugin = this
        EclipsiaStore.init(context.applicationContext)
        EclipsiaTmdb.init(EclipsiaStore)
        EclipsiaPosters.init(EclipsiaStore, "eclipsia_anime_imdb_ids")
        val anyCatalog = EclipsiaStore.kitsuEnabled || EclipsiaStore.anilistEnabled
        if (EclipsiaStore.kitsuEnabled || !anyCatalog) registerMainAPI(EclipsiaKitsuProvider())
        if (EclipsiaStore.anilistEnabled) registerMainAPI(EclipsiaAnilistProvider())

        openSettings = { ctx -> EclipsiaSettingsUi.show(ctx) }
    }
}
