package com.playz.core

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Test
import org.mozilla.javascript.Context

class PlayzScriptCompileTest {
    private val assets = File("src/main/assets/playz")
    private val shims = File("../shared/src/playz/main/assets/shim")

    private fun scripts(): List<File> = listOf(
        File(shims, "shim-common.js"),
        File(shims, "contract-playz.js"),
        File(assets, "core.js"),
        File(assets, "catalog.js"),
        File(assets, "stream.js"),
    )

    @Suppress("DEPRECATION")
    private fun <T> rhino(block: (Context) -> T): T {
        val cx = Context.enter()
        try {
            cx.optimizationLevel = -1
            cx.languageVersion = Context.VERSION_ES6
            return block(cx)
        } finally {
            Context.exit()
        }
    }

    @Test
    fun scriptFilesExist() {
        scripts().forEach { assertTrue(it.path, it.isFile) }
    }

    @Test
    fun everyScriptCompilesUnderRhino() {
        rhino { cx ->
            scripts().forEach { f ->
                cx.compileString(f.readText(), f.name, 1, null)
            }
        }
    }

    @Test
    fun scriptsAreFreeOfEs6OnlySyntax() {
        val banned = listOf(
            Regex("""\basync\s+function"""),
            Regex("""\bawait\s"""),
            Regex("""\blet\s+[A-Za-z_$]"""),
            Regex("""\bconst\s+[A-Za-z_$]"""),
            Regex("""=>"""),
            Regex("""`"""),
        )
        scripts().filter { it.parentFile == assets }.forEach { f ->
            val text = f.readText()
            banned.forEach { assertTrue(f.name + " " + it.pattern, !it.containsMatchIn(text)) }
        }
    }
}
