package com.soryn

import android.content.Context
import com.lagradost.cloudstream3.plugins.CloudstreamPlugin
import com.lagradost.cloudstream3.plugins.Plugin
import com.soryn.core.ui.Fonts

@CloudstreamPlugin
class SorynPlugin : Plugin() {
    override fun load(context: Context) {
        SorynEngine.plugin = this
        SorynStore.init(context)
        SorynTitles.init(context)
        SorynSettings.init(context)
        Fonts.source = { resources?.assets }

        val all = SorynEngine.variants()
        val enabled = all.filter { SorynSettings.catalogEnabled(it.id) }.ifEmpty { all }
        enabled.forEach { registerMainAPI(SorynProvider(it)) }

        openSettings = { ctx -> SorynSettingsUi.show(ctx) }
    }
}
