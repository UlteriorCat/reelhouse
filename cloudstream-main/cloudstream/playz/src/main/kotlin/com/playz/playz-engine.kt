package com.playz

import com.lagradost.cloudstream3.plugins.Plugin
import com.playz.core.Memo
import com.playz.core.js.AssetManagerReader
import com.playz.core.js.AssetReader
import com.playz.core.js.JsRunConfig
import com.playz.core.js.JsSource
import com.playz.core.js.RhinoEngine
import com.playz.core.source.SourceIntegrity
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap

class PlayzVariant(
    val id: String,
    val name: String,
    val shortName: String,
    val manifest: JSONObject,
) {
    val baseUrl: String get() = manifest.optString("baseUrl")
    val lang: String get() = manifest.optString("lang", "en")
}

object PlayzEngine {
    @Volatile
    var plugin: Plugin? = null

    private const val SHIM_COMMON = "shim/shim-common.js"
    private const val SHIM_CONTRACT = "shim/contract-playz.js"
    private const val SHIM_CORE = "playz/core.js"
    private const val SOURCE = "playz/source.json"
    private const val TIMEOUT_MS = 60_000L

    private val assets: AssetReader = AssetManagerReader { plugin?.resources?.assets }

    private val integrity = SourceIntegrity(assets)

    private val shims = Memo<List<JsSource>> {
        val common = integrity.readVerified(SHIM_COMMON)
        val contract = integrity.readVerified(SHIM_CONTRACT)
        val core = integrity.readVerified(SHIM_CORE)
        if (common == null || contract == null || core == null) null
        else listOf(JsSource(SHIM_COMMON, common), JsSource(SHIM_CONTRACT, contract), JsSource(SHIM_CORE, core))
    }

    private val scripts = ConcurrentHashMap<String, JsSource>()

    private fun script(file: String): JsSource? {
        scripts[file]?.let { return it }
        val code = integrity.readVerified("playz/$file") ?: return null
        return scripts.getOrPut(file) { JsSource("playz:$file", code) }
    }

    fun variants(): List<PlayzVariant> {
        val root = integrity.readVerified(SOURCE)?.let { runCatching { JSONObject(it) }.getOrNull() } ?: return emptyList()
        val baseUrl = root.optString("baseUrl")
        val lang = root.optString("lang", "en")
        val list = root.optJSONArray("variants") ?: return emptyList()
        return (0 until list.length()).mapNotNull { i ->
            val v = list.optJSONObject(i) ?: return@mapNotNull null
            val id = v.optString("id").ifBlank { return@mapNotNull null }
            val manifest = JSONObject()
            root.optJSONObject("config")?.let { c -> c.keys().forEach { manifest.put(it, c.get(it)) } }
            v.optJSONObject("config")?.let { c -> c.keys().forEach { manifest.put(it, c.get(it)) } }
            manifest.put("id", id)
            manifest.put("baseUrl", v.optString("baseUrl").ifBlank { baseUrl })
            manifest.put("lang", lang)
            val name = v.optString("name", id)
            PlayzVariant(id, name, v.optString("shortName", name), manifest)
        }
    }

    suspend fun call(variant: PlayzVariant, fn: String, arg: String? = null): JSONObject? {
        val shimList = shims.get() ?: return null
        val file = if (fn == "loadStreams") "stream.js" else "catalog.js"
        val src = script(file) ?: return null

        val settings = JSONObject().put("manifest", variant.manifest).put("cache", PlayzStore.snapshot()).toString()
        val args = JSONObject().put("fn", fn).put("arg", arg ?: JSONObject.NULL).toString()

        val raw = try {
            withTimeoutOrNull(TIMEOUT_MS + 5_000) {
                RhinoEngine.run(
                    shims = shimList,
                    script = src,
                    scraperId = variant.id,
                    mode = "run",
                    argsJson = args,
                    settingsJson = settings,
                    config = JsRunConfig(timeoutMs = TIMEOUT_MS),
                )
            }
        } catch (e: CancellationException) {
            throw e
        } catch (_: Throwable) {
            null
        } ?: return null

        val envelope = runCatching { JSONObject(raw) }.getOrNull() ?: return null
        PlayzStore.merge(envelope.optJSONObject("cache"))
        val res = envelope.optJSONObject("res") ?: return null
        return if (res.optBoolean("success")) res else null
    }
}
