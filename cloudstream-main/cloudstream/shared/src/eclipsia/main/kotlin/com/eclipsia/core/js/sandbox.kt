package com.eclipsia.core.js

import org.mozilla.javascript.ClassShutter
import org.mozilla.javascript.Context
import org.mozilla.javascript.ContextFactory
import org.mozilla.javascript.Scriptable
import org.mozilla.javascript.WrapFactory
import java.util.concurrent.atomic.AtomicBoolean

internal class JsDeadlineError : Error("js deadline")

internal object SafeWrapFactory : WrapFactory() {
    init {
        isJavaPrimitiveWrap = false
    }

    override fun wrapAsJavaObject(cx: Context?, scope: Scriptable?, javaObject: Any?, staticType: Class<*>?): Scriptable =
        throw SecurityException("Java objects are not exposed to scripts")
}

internal class SandboxContextFactory(
    private val deadlineNanos: Long,
    private val cancelled: AtomicBoolean,
) : ContextFactory() {

    @Suppress("DEPRECATION")
    override fun makeContext(): Context {
        val cx = super.makeContext()
        cx.optimizationLevel = -1
        cx.languageVersion = Context.VERSION_ES6
        cx.instructionObserverThreshold = 10_000
        cx.maximumInterpreterStackDepth = 256
        cx.setClassShutter(ClassShutter { false })
        cx.wrapFactory = SafeWrapFactory
        return cx
    }

    override fun observeInstructionCount(cx: Context, instructionCount: Int) {
        if (cancelled.get() || System.nanoTime() - deadlineNanos > 0) throw JsDeadlineError()
    }
}
