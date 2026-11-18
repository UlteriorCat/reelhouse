package com.soryn

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray

object SorynSettings {
    private const val PREFS = "soryn_settings"

    @Volatile
    private var prefs: SharedPreferences? = null

    fun init(context: Context) {
        prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    }

    var shortNames: Boolean
        get() = prefs?.getBoolean("short_names", true) ?: true
        set(v) { prefs?.edit()?.putBoolean("short_names", v)?.commit() }

    var hideLabels: Boolean
        get() = prefs?.getBoolean("hide_labels", false) ?: false
        set(v) { prefs?.edit()?.putBoolean("hide_labels", v)?.commit() }

    fun catalogEnabled(id: String): Boolean = prefs?.getBoolean("cat_$id", true) ?: true

    fun setCatalogEnabled(id: String, on: Boolean) {
        prefs?.edit()?.putBoolean("cat_$id", on)?.commit()
    }

    fun rowOrder(id: String): List<String> = readList("rows_$id")

    fun hiddenRows(id: String): Set<String> = readList("hidden_$id").toSet()

    fun siteOrder(id: String): List<String> = readList("site_$id")

    fun saveRows(id: String, order: List<String>, hidden: Set<String>) {
        prefs?.edit()
            ?.putString("rows_$id", JSONArray(order).toString())
            ?.putString("hidden_$id", JSONArray(hidden.toList()).toString())
            ?.commit()
    }

    fun recordRows(id: String, seen: List<String>) {
        if (seen.isEmpty()) return
        prefs?.edit()?.putString("site_$id", JSONArray(seen).toString())?.commit()
        val known = rowOrder(id)
        val fresh = seen.filter { it !in known }
        if (fresh.isEmpty()) return
        saveRows(id, known + fresh, hiddenRows(id))
    }

    fun applyRows(id: String, lists: Map<String, List<SorynCard>>): List<Pair<String, List<SorynCard>>> {
        val order = rowOrder(id)
        val hidden = hiddenRows(id)
        val names = lists.keys.filter { it !in hidden }
        val rank = names.sortedBy { n -> order.indexOf(n).let { if (it < 0) Int.MAX_VALUE else it } }
        return rank.map { it to lists.getValue(it) }
    }

    private fun readList(key: String): List<String> {
        val raw = prefs?.getString(key, null) ?: return emptyList()
        val arr = runCatching { JSONArray(raw) }.getOrNull() ?: return emptyList()
        return (0 until arr.length()).mapNotNull { arr.optString(it).takeIf { s -> s.isNotEmpty() } }
    }

    private val SORT_ORDER = listOf("netflix", "prime", "disney", "hotstar", "marvel", "pixar", "starwars")
    private val SORT_CHARS = listOf('\u200B', '\u200C', '\u200D', '\u2060', '\u2061', '\u2062', '\u2063')

    fun displayName(v: SorynVariant): String {
        val rank = SORT_ORDER.indexOf(v.id)
        val prefix = if (rank >= 0) SORT_CHARS[rank] else '\u2064'
        return prefix + (if (shortNames) v.shortName else v.name)
    }
}

class SorynCard(val title: String, val url: String, val poster: String?, val series: Boolean)
