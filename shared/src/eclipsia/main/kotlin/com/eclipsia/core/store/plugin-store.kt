package com.eclipsia.core.store

import android.content.Context
import android.content.SharedPreferences

abstract class PluginStore(
    private val prefsName: String,
    private val label: String,
    protected val defaultTmdbKey: String,
) {
    private var appContext: Context? = null

    fun init(ctx: Context) {
        appContext = ctx
    }

    val context: Context
        get() = appContext ?: error("$label plugin has not been loaded yet")

    protected val prefs: SharedPreferences
        get() = context.getSharedPreferences(prefsName, Context.MODE_PRIVATE)

    fun setEnabled(scraperId: String, enabled: Boolean) {
        prefs.edit().putBoolean("enabled_$scraperId", enabled).apply()
    }

    private val DEFAULT_CONCURRENCY = 6
    private val LOW_END_CONCURRENCY = 3
    val MAX_CONCURRENCY = 72
    val CONCURRENCY_STEP = 3

    fun defaultConcurrency(): Int {
        val c = appContext ?: return DEFAULT_CONCURRENCY
        val lowRam = runCatching {
            (c.getSystemService(Context.ACTIVITY_SERVICE) as android.app.ActivityManager).isLowRamDevice
        }.getOrDefault(false)
        val tv = runCatching {
            (c.getSystemService(Context.UI_MODE_SERVICE) as android.app.UiModeManager).currentModeType ==
                android.content.res.Configuration.UI_MODE_TYPE_TELEVISION
        }.getOrDefault(false)
        return if (lowRam || tv) LOW_END_CONCURRENCY else DEFAULT_CONCURRENCY
    }

    var concurrency: Int
        get() = prefs.getInt("concurrency", defaultConcurrency()).coerceIn(1, MAX_CONCURRENCY)
        set(value) {
            prefs.edit().putInt("concurrency", value.coerceIn(1, MAX_CONCURRENCY)).apply()
        }

    var concurrencyAuto: Boolean
        get() = prefs.getBoolean("concurrency_auto", true)
        set(value) {
            prefs.edit().putBoolean("concurrency_auto", value).apply()
        }

    val TIMEOUT_AUTO = 0
    val MIN_TIMEOUT_SECONDS = 5
    val MAX_TIMEOUT_SECONDS = 180
    val TIMEOUT_STEP_SECONDS = 5

    var timeoutSeconds: Int
        get() = prefs.getInt("timeout_seconds", TIMEOUT_AUTO).let {
            if (it <= TIMEOUT_AUTO) TIMEOUT_AUTO else it.coerceIn(MIN_TIMEOUT_SECONDS, MAX_TIMEOUT_SECONDS)
        }
        set(value) {
            val v = if (value < MIN_TIMEOUT_SECONDS) TIMEOUT_AUTO else value.coerceAtMost(MAX_TIMEOUT_SECONDS)
            prefs.edit().putInt("timeout_seconds", v).apply()
        }

    var customPosterEnabled: Boolean
        get() = prefs.getBoolean("poster_custom", false)
        set(value) {
            prefs.edit().putBoolean("poster_custom", value).apply()
        }

    var customPosterTemplate: String
        get() = prefs.getString("poster_template", "") ?: ""
        set(value) {
            prefs.edit().putString("poster_template", value.trim()).apply()
        }

    fun flush() {
        runCatching { prefs.edit().commit() }
    }
}
