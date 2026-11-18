package com.eclipsia.core.js

import android.content.res.AssetManager

interface AssetReader {
    fun readBytes(path: String): ByteArray?
    fun readText(path: String): String? = readBytes(path)?.toString(Charsets.UTF_8)
}

class AssetManagerReader(private val manager: () -> AssetManager?) : AssetReader {
    override fun readBytes(path: String): ByteArray? = try {
        manager()?.open(path)?.use { it.readBytes() }
    } catch (_: Exception) {
        null
    }
}
