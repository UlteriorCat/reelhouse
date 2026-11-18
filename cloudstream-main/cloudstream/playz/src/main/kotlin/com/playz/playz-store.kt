package com.playz

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONObject

object PlayzStore {
    private const val PREFS = "playz_cache"
    private const val MAX_VALUE_CHARS = 1_000_000
    private const val MAX_TOTAL_CHARS = 2_000_000
    private val PERSISTED = setOf("active_base_url", "remote_base_urls")

    private class Entry(val json: JSONObject, val size: Int, val time: Long)

    private val memory = LinkedHashMap<String, Entry>()

    @Volatile
    private var prefs: SharedPreferences? = null

    fun init(context: Context) {
        prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    }

    fun snapshot(): JSONObject {
        val out = JSONObject()
        val p = prefs
        if (p != null) {
            for (key in PERSISTED) {
                val raw = p.getString(key, null) ?: continue
                val entry = runCatching { JSONObject(raw) }.getOrNull() ?: continue
                out.put(key, entry)
            }
        }
        synchronized(memory) {
            for ((key, entry) in memory) out.put(key, entry.json)
        }
        return out
    }

    fun merge(changes: JSONObject?) {
        if (changes == null || changes.length() == 0) return
        val persist = prefs?.edit()
        synchronized(memory) {
            for (key in changes.keys()) {
                val entry = changes.optJSONObject(key) ?: continue
                val text = entry.toString()
                if (text.length > MAX_VALUE_CHARS) continue
                memory.remove(key)
                memory[key] = Entry(entry, text.length, entry.optLong("t"))
                if (key in PERSISTED) persist?.putString(key, text)
            }
            var total = memory.values.sumOf { it.size }
            while (total > MAX_TOTAL_CHARS && memory.isNotEmpty()) {
                val oldest = memory.entries.minByOrNull { it.value.time } ?: break
                total -= oldest.value.size
                memory.remove(oldest.key)
            }
        }
        persist?.apply()
    }
}
