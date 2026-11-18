package com.playz

import android.content.Context
import com.lagradost.cloudstream3.plugins.CloudstreamPlugin
import com.lagradost.cloudstream3.plugins.Plugin
import com.playz.core.ui.Fonts
import com.playz.poster.PosterAssets

@CloudstreamPlugin
class PlayzPlugin : Plugin() {
    override fun load(context: Context) {
        PlayzEngine.plugin = this
        PlayzStore.init(context)
        PlayzSettings.init(context)
        Fonts.source = { resources?.assets }
        PosterAssets.init(context) { resources?.assets }

        PlayzEngine.variants().firstOrNull()?.let { registerMainAPI(PlayzProvider(it)) }

        openSettings = { ctx -> PlayzSettingsUi.show(ctx) }
    }
}
