package com.eclipsia.core.ui

import android.content.res.AssetManager
import android.graphics.Typeface

internal object Fonts {
    @Volatile
    var source: (() -> AssetManager?)? = null

    private val cache = HashMap<String, Typeface>()

    private fun load(name: String, fallbackStyle: Int): Typeface = synchronized(cache) {
        cache[name]?.let { return it }
        val assets = source?.invoke() ?: return Typeface.create(Typeface.SANS_SERIF, fallbackStyle)
        val face = try {
            Typeface.createFromAsset(assets, "fonts/$name.ttf")
        } catch (_: Exception) {
            return Typeface.create(Typeface.SANS_SERIF, fallbackStyle)
        }
        cache[name] = face
        face
    }

    val regular: Typeface get() = load("inter-regular", Typeface.NORMAL)

    val medium: Typeface get() = load("inter-medium", Typeface.NORMAL)

    val bold: Typeface get() = load("inter-bold", Typeface.BOLD)
}
