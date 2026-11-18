package com.eclipsiabdix

import com.eclipsia.core.js.AssetManagerReader
import com.eclipsia.core.ui.Fonts
import com.eclipsia.core.js.AssetReader
import com.eclipsia.core.js.JsEnv
import com.eclipsia.core.js.JsRunner
import com.eclipsia.core.js.RhinoJsRunner
import com.eclipsia.core.source.SourceIntegrity
import com.lagradost.cloudstream3.plugins.Plugin

object EclipsiaEngine {
    @Volatile
    var plugin: Plugin? = null

    val assets: AssetReader = AssetManagerReader { plugin?.resources?.assets }

    init {
        Fonts.source = { plugin?.resources?.assets }
    }

    val integrity: SourceIntegrity by lazy { SourceIntegrity(assets) }

    private val env = object : JsEnv {
        override fun tmdbKey(): String = EclipsiaStore.tmdbKey()
        override fun settingsJson(scraperId: String): String = "{}"
        override fun concurrency(): Int = EclipsiaRepository.effectiveConcurrency()
    }

    val runner: JsRunner by lazy { RhinoJsRunner(integrity, env) }
}
