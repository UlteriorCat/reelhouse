package com.eclipsia.core.store

import android.content.SharedPreferences

internal class DiskCache(
    private val prefsProvider: () -> SharedPreferences,
    private val maxEntries: Int,
) {
    private val prefs by lazy(prefsProvider)
    private val lock = Any()
    private var count = -1

    fun get(key: String): String? = prefs.getString(key, null)?.substringBeforeLast(SEP)

    fun put(key: String, value: String) {
        synchronized(lock) {
            if (count < 0) count = prefs.all.size
            val isNew = !prefs.contains(key)
            if (isNew) count++
            val edit = prefs.edit()
            if (count > maxEntries) count -= evict(edit, key)
            edit.putString(key, value + SEP + System.currentTimeMillis()).apply()
        }
    }

    private fun evict(edit: SharedPreferences.Editor, keep: String): Int {
        val drop = count - maxEntries + maxEntries / 10
        val oldest = prefs.all.entries
            .filter { it.key != keep }
            .sortedBy { (it.value as? String)?.substringAfterLast(SEP, "")?.toLongOrNull() ?: 0L }
            .take(drop)
        oldest.forEach { edit.remove(it.key) }
        return oldest.size
    }

    private companion object {
        const val SEP = '|'
    }
}
