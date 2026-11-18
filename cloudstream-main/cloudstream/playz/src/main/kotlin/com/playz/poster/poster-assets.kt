package com.playz.poster

import android.content.Context
import android.content.res.AssetManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Typeface
import com.playz.core.Memo
import java.io.File
import java.util.concurrent.ConcurrentHashMap

internal object PosterAssets {
    private const val FONT_DIR = "poster/fonts"
    private const val FLAG_DIR = "poster/flags"

    @Volatile
    private var source: (() -> AssetManager?)? = null

    @Volatile
    var cacheDir: File? = null
        private set

    private val faces = ConcurrentHashMap<String, Typeface>()

    private val flagCodes = Memo<Set<String>> {
        source?.invoke()?.list(FLAG_DIR)
            ?.filter { it.endsWith(".webp") }
            ?.map { it.removeSuffix(".webp") }
            ?.toSet()
            ?.takeIf { it.isNotEmpty() }
    }

    fun init(context: Context, assets: () -> AssetManager?) {
        cacheDir = context.applicationContext.cacheDir
        source = assets
    }

    private fun face(file: String, fallback: Typeface): Typeface {
        faces[file]?.let { return it }
        val manager = source?.invoke() ?: return fallback
        val loaded = try {
            Typeface.createFromAsset(manager, "$FONT_DIR/$file")
        } catch (_: Exception) {
            return fallback
        }
        return faces.putIfAbsent(file, loaded) ?: loaded
    }

    val sans: Typeface get() = face("archivo-regular.otf", Typeface.create("sans-serif", Typeface.NORMAL))

    val display: Typeface get() = face("bagnard.otf", Typeface.create("serif", Typeface.BOLD))

    val brand: Typeface get() = face("bluu-next-titling.otf", Typeface.create("serif", Typeface.NORMAL))

    fun hasFlag(code: String): Boolean = flagCodes.get()?.contains(code) == true

    fun flag(code: String): Bitmap? {
        val manager = source?.invoke() ?: return null
        return try {
            manager.open("$FLAG_DIR/$code.webp").use { BitmapFactory.decodeStream(it) }
        } catch (_: Exception) {
            null
        }
    }
}
