package com.eclipsia.core.js

import com.eclipsia.core.Memo
import com.eclipsia.core.map.JsStream
import com.eclipsia.core.source.SourceIntegrity
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONArray
import org.json.JSONObject

class RhinoJsRunner(
    private val integrity: SourceIntegrity,
    private val env: JsEnv,
    private val config: JsRunConfig = JsRunConfig(),
) : JsRunner {

    private val shims = Memo<List<JsSource>> {
        val common = integrity.readVerified(SHIM_COMMON)
        val contract = integrity.readVerified(SHIM_SCRAPER)
        if (common == null || contract == null) null
        else listOf(JsSource(SHIM_COMMON, common), JsSource(SHIM_SCRAPER, contract))
    }

    private var gate: Semaphore? = null
    private var gateLimit = 0

    @Synchronized
    private fun currentGate(): Semaphore {
        val n = env.concurrency().coerceAtLeast(1)
        val existing = gate
        if (existing == null || n != gateLimit) {
            val fresh = Semaphore(n)
            gate = fresh
            gateLimit = n
            return fresh
        }
        return existing
    }

    override suspend fun callScraper(
        ref: ScraperRef,
        tmdbId: String,
        mediaType: String,
        season: Int?,
        episode: Int?,
    ): List<JsStream> {
        val args = JSONObject()
            .put("tmdbId", tmdbId)
            .put("mediaType", mediaType)
            .put("season", season ?: JSONObject.NULL)
            .put("episode", episode ?: JSONObject.NULL)
            .toString()
        val raw = execute(ref, "run", args, env.settingsJson(ref.id)) ?: return emptyList()
        return JsStream.parseList(raw)
    }

    override suspend fun settingsLayout(ref: ScraperRef): JSONArray {
        val raw = execute(ref, "settings", "{}", "{}") ?: return JSONArray()
        return sanitizeLayout(runCatching { JSONArray(raw) }.getOrDefault(JSONArray()))
    }

    private suspend fun execute(ref: ScraperRef, mode: String, argsJson: String, settingsJson: String): String? {
        val shimList = shims.get() ?: return null
        val code = integrity.readVerified(ref.path) ?: return null
        return try {
            currentGate().withPermit {
                withTimeoutOrNull(config.timeoutMs + 5_000) { RhinoEngine.run(
                    shims = shimList,
                    script = JsSource("scraper:${ref.id}", code),
                    scraperId = ref.id,
                    mode = mode,
                    argsJson = argsJson,
                    settingsJson = settingsJson,
                    tmdbKey = env.tmdbKey(),
                    config = config,
                ) }
            }
        } catch (e: CancellationException) {
            throw e
        } catch (_: Throwable) {
            null
        }
    }

    private fun sanitizeLayout(arr: JSONArray): JSONArray {
        val out = JSONArray()
        for (i in 0 until minOf(arr.length(), 64)) {
            val o = arr.optJSONObject(i) ?: continue
            if (o.optString("type") in KNOWN_SETTING_TYPES) out.put(o)
        }
        return out
    }

    companion object {
        const val SHIM_COMMON = "shim/shim-common.js"
        const val SHIM_SCRAPER = "shim/contract-scraper.js"
        private val KNOWN_SETTING_TYPES = setOf("header", "info", "toggle", "select")
    }
}
