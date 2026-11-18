package com.soryn

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONObject

object SorynStore {
    private const val PREFS = "soryn_cache"
    private const val MAX_ENTRIES = 64
    private const val MAX_VALUE_CHARS = 16 * 1024

    @Volatile
    private var prefs: SharedPreferences? = null

    fun init(context: Context) {
        prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    }

    fun snapshot(): JSONObject {
        val out = JSONObject()
        val p = prefs ?: return out
        for ((k, v) in p.all) {
            val raw = v as? String ?: continue
            val entry = runCatching { JSONObject(raw) }.getOrNull() ?: continue
            out.put(k, entry)
        }
        return out
    }

    fun merge(changes: JSONObject?) {
        val p = prefs ?: return
        if (changes == null || changes.length() == 0) return
        val edit = p.edit()
        for (key in changes.keys()) {
            val entry = changes.optJSONObject(key) ?: continue
            val text = entry.toString()
            if (text.length > MAX_VALUE_CHARS) continue
            edit.putString(key, text)
        }
        edit.apply()
        if (p.all.size > MAX_ENTRIES) {
            val cleanup = p.edit()
            p.all.entries
                .sortedBy { runCatching { JSONObject(it.value as String).optLong("t") }.getOrDefault(0L) }
                .take(p.all.size - MAX_ENTRIES)
                .forEach { cleanup.remove(it.key) }
            cleanup.apply()
        }
    }
}

object SorynTitles {
    private const val PREFS = "soryn_titles"
    private const val MAX_ENTRIES = 4000

    @Volatile
    private var prefs: SharedPreferences? = null

    fun init(context: Context) {
        prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    }

    fun get(variant: String, id: String): String? = prefs?.getString("$variant:$id", null)

    fun putAll(variant: String, titles: Map<String, String>) {
        val p = prefs ?: return
        if (titles.isEmpty()) return
        val edit = p.edit()
        titles.forEach { (id, t) -> edit.putString("$variant:$id", t) }
        edit.apply()
        val size = p.all.size
        if (size > MAX_ENTRIES) {
            val drop = p.all.keys.take(size - MAX_ENTRIES)
            val cleanup = p.edit()
            drop.forEach { cleanup.remove(it) }
            cleanup.apply()
        }
    }
}
