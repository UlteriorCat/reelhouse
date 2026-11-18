package com.soryn

import com.soryn.core.Memo
import com.soryn.core.js.AssetManagerReader
import com.soryn.core.js.AssetReader
import com.soryn.core.js.JsRunConfig
import com.soryn.core.js.JsSource
import com.soryn.core.js.RhinoEngine
import com.soryn.core.source.SourceIntegrity
import com.lagradost.cloudstream3.plugins.Plugin
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap

class SorynVariant(
    val id: String,
    val name: String,
    val shortName: String,
    val home: Boolean,
    val manifest: JSONObject,
) {
    val baseUrl: String get() = manifest.optString("baseUrl")
    val lang: String get() = manifest.optString("lang", "en")
}

object SorynEngine {
    @Volatile
    var plugin: Plugin? = null

    private const val SHIM_COMMON = "shim/shim-common.js"
    private const val SHIM_CONTRACT = "shim/contract-soryn.js"
    private const val SOURCE = "soryn/source.json"
    private const val TIMEOUT_MS = 60_000L

    private val assets: AssetReader = AssetManagerReader { plugin?.resources?.assets }

    private val integrity = SourceIntegrity(assets)

    private val shims = Memo<List<JsSource>> {
        val common = integrity.readVerified(SHIM_COMMON)
        val contract = integrity.readVerified(SHIM_CONTRACT)
        if (common == null || contract == null) null
        else listOf(JsSource(SHIM_COMMON, common), JsSource(SHIM_CONTRACT, contract))
    }

    private val scripts = ConcurrentHashMap<String, JsSource>()

    private fun script(file: String): JsSource? {
        scripts[file]?.let { return it }
        val code = integrity.readVerified("soryn/$file") ?: return null
        return scripts.getOrPut(file) { JsSource("soryn:$file", code) }
    }

    fun variants(): List<SorynVariant> {
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
            SorynVariant(id, v.optString("name", id), v.optString("shortName", id), v.optBoolean("home", true), manifest)
        }
    }

    suspend fun call(variant: SorynVariant, fn: String, arg: String? = null): JSONObject? {
        val shimList = shims.get() ?: return null
        val file = if (fn == "loadStreams") "stream.js" else "catalog.js"
        val src = script(file) ?: return null

        val settings = JSONObject().put("manifest", variant.manifest).put("cache", SorynStore.snapshot()).toString()
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
        SorynStore.merge(envelope.optJSONObject("cache"))
        val res = envelope.optJSONObject("res") ?: return null
        return if (res.optBoolean("success")) res else null
    }
}
