package com.eclipsia.core.js

import android.util.Base64
import com.eclipsia.core.net.CookieStore
import com.eclipsia.core.net.HttpBudget
import com.eclipsia.core.net.SafeHttp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import org.json.JSONObject
import org.mozilla.javascript.BaseFunction
import org.mozilla.javascript.Context
import org.mozilla.javascript.Function
import org.mozilla.javascript.RhinoException
import org.mozilla.javascript.Script
import org.mozilla.javascript.Scriptable
import org.mozilla.javascript.ScriptableObject
import org.mozilla.javascript.Undefined
import org.mozilla.javascript.typedarrays.NativeArrayBuffer
import java.nio.charset.Charset
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import kotlin.coroutines.resume

class JsRunConfig(
    val timeoutMs: Long = 60_000,
    val maxRequests: Int = HttpBudget.DEFAULT_MAX_REQUESTS,
    val maxInFlight: Int = 6,
    val maxTotalBytes: Long = HttpBudget.DEFAULT_MAX_TOTAL_BYTES,
)

class JsSource(val name: String, val code: String)

object RhinoEngine {
    @Volatile
    var unavailableReason: String? = null
        private set

    private const val STACK_BYTES = 4L * 1024 * 1024
    private const val MAX_LIVE_THREADS = 72

    private val liveThreads = AtomicInteger(0)

    private class Compiled(val code: String, val script: Script)

    private val sharedScope: ScriptableObject by lazy {
        val factory = SandboxContextFactory(Long.MAX_VALUE, AtomicBoolean(false))
        val cx = factory.enterContext()
        try {
            cx.initSafeStandardObjects(null, true)
        } finally {
            Context.exit()
        }
    }

    private fun newRunScope(cx: Context): Scriptable {
        val shared = sharedScope
        val scope = cx.newObject(shared)
        scope.prototype = shared
        scope.parentScope = null
        return scope
    }

    private val compiled = ConcurrentHashMap<String, Compiled>()

    private fun compile(cx: Context, source: JsSource, wrap: Boolean): Script {
        val hit = compiled[source.name]
        if (hit != null && hit.code === source.code) return hit.script
        val text = if (wrap) "(function(){\n${source.code}\n}).call(this);" else source.code
        val script = cx.compileString(text, source.name, if (wrap) 0 else 1, null)
        compiled[source.name] = Compiled(source.code, script)
        return script
    }

    suspend fun run(
        shims: List<JsSource>,
        script: JsSource,
        scraperId: String,
        mode: String,
        argsJson: String,
        settingsJson: String,
        tmdbKey: String,
        config: JsRunConfig = JsRunConfig(),
    ): String? {
        if (unavailableReason != null) return null
        if (liveThreads.incrementAndGet() > MAX_LIVE_THREADS) {
            liveThreads.decrementAndGet()
            return null
        }
        return try {
            suspendCancellableCoroutine { cont ->
                val run = Run(shims, script, scraperId, mode, argsJson, settingsJson, tmdbKey, config) { result ->
                    if (cont.isActive) cont.resume(result)
                }
                cont.invokeOnCancellation { run.cancel() }
                try {
                    Thread(null, run, "eclipsia-js-$scraperId", STACK_BYTES).apply { isDaemon = true }.start()
                } catch (t: Throwable) {
                    liveThreads.decrementAndGet()
                    if (t is LinkageError) throw t
                    if (cont.isActive) cont.resume(null)
                }
            }
        } catch (e: LinkageError) {
            unavailableReason = e.javaClass.simpleName + ": " + e.message
            null
        }
    }

    private class HostFn(
        private val fnName: String,
        private val body: (Array<Any?>) -> Any?,
    ) : BaseFunction() {
        override fun call(cx: Context, scope: Scriptable, thisObj: Scriptable?, args: Array<Any?>): Any? =
            body(args) ?: Undefined.instance

        override fun getFunctionName(): String = fnName
        override fun getArity(): Int = 0
        override fun getLength(): Int = 0
    }

    private class Run(
        private val shims: List<JsSource>,
        private val script: JsSource,
        private val scraperId: String,
        private val mode: String,
        private val argsJson: String,
        private val settingsJson: String,
        private val tmdbKey: String,
        private val config: JsRunConfig,
        private val finish: (String?) -> Unit,
    ) : Runnable {
        private val cancelled = AtomicBoolean(false)
        private val loop = EventLoop()
        private val budget = HttpBudget(config.maxRequests, config.maxTotalBytes)
        private val cookies = CookieStore()

        @Volatile
        private var result: String? = null

        @Volatile
        private var done = false

        fun cancel() {
            cancelled.set(true)
            loop.wake()
        }

        override fun run() {
            val io = CoroutineScope(SupervisorJob() + Dispatchers.IO)
            var entered = false
            try {
                val deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(config.timeoutMs)
                val factory = SandboxContextFactory(deadline, cancelled)
                val cx = factory.enterContext()
                entered = true
                val scope = newRunScope(cx)

                installHost(cx, scope, io)

                for (s in shims) compile(cx, s, wrap = false).exec(cx, scope)
                ScriptableObject.deleteProperty(scope, "Host")

                compile(cx, script, wrap = true).exec(cx, scope)

                callGlobal(cx, scope, "__call", arrayOf(mode, argsJson))
                pump(cx, scope, deadline)
            } catch (e: LinkageError) {
                unavailableReason = e.javaClass.simpleName + ": " + e.message
            } catch (_: Throwable) {
                result = null
            } finally {
                loop.close()
                io.cancel()
                if (entered) runCatching { Context.exit() }
                liveThreads.decrementAndGet()
                finish(if (done) result else null)
            }
        }

        private fun pump(cx: Context, scope: Scriptable, deadline: Long) {
            drain(cx, scope)
            while (!done && !cancelled.get()) {
                val remaining = deadline - System.nanoTime()
                if (remaining <= 0) throw JsDeadlineError()

                for (id in loop.dueTimers()) {
                    safely { callGlobal(cx, scope, "__onTimer", arrayOf(id)) }
                    drain(cx, scope)
                    if (done) return
                }

                val nothingPending = !loop.hasQueued() && !loop.hasTimers() && loop.inFlight.get() == 0
                if (nothingPending) return

                val wait = minOf(remaining, loop.nextTimerDelayNanos() ?: remaining)
                val task = loop.poll(wait) ?: continue
                safely { task.run() }
                drain(cx, scope)
            }
        }

        private fun drain(cx: Context, scope: Scriptable) {
            safely { cx.processMicrotasks() }
            safely { callGlobal(cx, scope, "__drainMicrotasks", emptyArray()) }
        }

        private inline fun safely(block: () -> Unit) {
            try {
                block()
            } catch (e: JsDeadlineError) {
                throw e
            } catch (_: RhinoException) {
            } catch (_: RuntimeException) {
            }
        }

        private fun callGlobal(cx: Context, scope: Scriptable, name: String, args: Array<Any?>): Any? {
            val f = ScriptableObject.getProperty(scope, name)
            return if (f is Function) f.call(cx, scope, scope, args) else null
        }

        private fun installHost(cx: Context, scope: Scriptable, io: CoroutineScope) {
            val host = cx.newObject(scope)
            val gate = Semaphore(config.maxInFlight)

            fun def(name: String, body: (Array<Any?>) -> Any?) {
                val fn = HostFn(name, body)
                fn.parentScope = scope
                fn.prototype = ScriptableObject.getFunctionPrototype(scope)
                ScriptableObject.putProperty(host, name, fn)
            }
            fun str(a: Array<Any?>, i: Int): String = if (i < a.size) Context.toString(a[i]) else ""
            fun num(a: Array<Any?>, i: Int): Double = if (i < a.size) Context.toNumber(a[i]) else 0.0
            fun bool(a: Array<Any?>, i: Int): Boolean = i < a.size && Context.toBoolean(a[i])

            def("meta") { JSONObject().put("id", scraperId).toString() }
            def("settings") { settingsJson }
            def("tmdbKey") { SafeHttp.TMDB_PLACEHOLDER }

            def("fetch") { a ->
                val id = num(a, 0).toInt()
                val url = str(a, 1)
                val method = str(a, 2)
                val headers = str(a, 3)
                val body = str(a, 4)
                val hasBody = bool(a, 5)
                val follow = bool(a, 6)
                val useCookies = bool(a, 7)
                loop.inFlight.incrementAndGet()
                io.launch {
                    val json = try {
                        gate.withPermit { SafeHttp.execute(budget, tmdbKey, url, method, headers, body, hasBody, follow, if (useCookies) cookies else null) }
                    } catch (e: CancellationException) {
                        throw e
                    } catch (_: Throwable) {
                        null
                    }
                    loop.post(Runnable {
                        loop.inFlight.decrementAndGet()
                        val c = Context.getCurrentContext() ?: return@Runnable
                        callGlobal(c, scope, "__onFetch", arrayOf(id, json ?: ""))
                    })
                }
                Undefined.instance
            }

            def("decode") { a ->
                val bytes = Base64.decode(str(a, 0), Base64.DEFAULT)
                val name = str(a, 1).ifBlank { "utf-8" }
                val cs = try { Charset.forName(name) } catch (_: Exception) { Charsets.UTF_8 }
                val text = String(bytes, cs)
                if (cs == Charsets.UTF_8 && text.startsWith("﻿")) text.substring(1) else text
            }
            def("encodeUtf8") { a -> Base64.encodeToString(str(a, 0).toByteArray(Charsets.UTF_8), Base64.NO_WRAP) }

            def("arrayBuffer") { a ->
                val bytes = Base64.decode(str(a, 0), Base64.DEFAULT)
                val c = Context.getCurrentContext()
                val buf = c.newObject(scope, "ArrayBuffer", arrayOf<Any>(bytes.size.toDouble()))
                System.arraycopy(bytes, 0, (buf as NativeArrayBuffer).buffer, 0, bytes.size)
                buf
            }

            def("timer") { a ->
                loop.addTimer(num(a, 0).toInt(), num(a, 1).toLong())
                Undefined.instance
            }
            def("clearTimer") { a ->
                loop.cancelTimer(num(a, 0).toInt())
                Undefined.instance
            }

            def("done") { a ->
                if (!done) {
                    result = str(a, 0)
                    done = true
                }
                loop.wake()
                Undefined.instance
            }

            ScriptableObject.putProperty(scope, "Host", host)
        }
    }
}
