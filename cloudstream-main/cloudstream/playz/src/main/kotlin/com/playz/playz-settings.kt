package com.playz

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray

object PlayzSettings {
    private const val PREFS = "playz_settings"

    const val PINNED_ROW = "Live Now"
    const val POSTER_LIST_SCALE = 1.5f
    const val POSTER_DETAIL_SCALE = 3.5f

    @Volatile
    private var prefs: SharedPreferences? = null

    @Volatile
    private var lowRam = false

    fun init(context: Context) {
        lowRam = runCatching {
            (context.getSystemService(Context.ACTIVITY_SERVICE) as android.app.ActivityManager).isLowRamDevice
        }.getOrDefault(false)
        prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    }

    fun flush() {
        runCatching { prefs?.edit()?.commit() }
    }

    var posterConcurrency: Int
        get() = (prefs?.getInt("poster_concurrency", 0) ?: 0).takeIf { it > 0 } ?: if (lowRam) 6 else 16
        set(v) { prefs?.edit()?.putInt("poster_concurrency", v.coerceIn(1, 32))?.apply() }

    var horizontalPosters: Boolean
        get() = prefs?.getBoolean("horizontal_posters", false) ?: false
        set(v) { prefs?.edit()?.putBoolean("horizontal_posters", v)?.apply() }

    fun seenRows(): List<String> = readList("rows_seen")

    fun setSeenRows(titles: List<String>) {
        prefs?.edit()?.putString("rows_seen", JSONArray(titles).toString())?.apply()
    }

    fun rowEnabled(title: String): Boolean = prefs?.getBoolean("row_enabled_$title", true) ?: true

    fun setRowEnabled(title: String, enabled: Boolean) {
        prefs?.edit()?.putBoolean("row_enabled_$title", enabled)?.apply()
    }

    fun rowOrder(defaults: List<String>): List<String> {
        val saved = readList("row_order").filter { it in defaults }.distinct()
        return pinFirst(saved + defaults.filter { it !in saved })
    }

    fun setRowOrder(titles: List<String>) {
        prefs?.edit()?.putString("row_order", JSONArray(pinFirst(titles)).toString())?.apply()
    }

    fun pinFirst(titles: List<String>): List<String> =
        if (PINNED_ROW in titles) listOf(PINNED_ROW) + titles.filter { it != PINNED_ROW } else titles

    private fun readList(key: String): List<String> {
        val raw = prefs?.getString(key, null) ?: return emptyList()
        val arr = runCatching { JSONArray(raw) }.getOrNull() ?: return emptyList()
        return (0 until arr.length()).mapNotNull { arr.optString(it).takeIf { s -> s.isNotEmpty() } }
    }
}
