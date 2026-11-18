package com.eclipsiabdix

import android.content.Context
import com.eclipsia.core.catalog.EclipsiaPosters
import com.eclipsia.core.net.AddressPolicy
import com.lagradost.cloudstream3.plugins.CloudstreamPlugin
import com.lagradost.cloudstream3.plugins.Plugin

@CloudstreamPlugin
class EclipsiaBDIXPlugin : Plugin() {
    override fun load(context: Context) {
        EclipsiaEngine.plugin = this
        EclipsiaStore.init(context.applicationContext)
        EclipsiaPosters.init(EclipsiaStore, "eclipsia_bdix_imdb_ids")
        AddressPolicy.allowPrivateNetworks = true
        registerMainAPI(EclipsiaBDIXProvider())
        openSettings = { ctx -> EclipsiaSettingsUi.show(ctx) }
    }
}
