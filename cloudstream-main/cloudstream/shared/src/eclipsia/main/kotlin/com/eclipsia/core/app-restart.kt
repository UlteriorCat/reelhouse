package com.eclipsia.core

import android.content.Context
import android.content.Intent
import android.os.Process

object AppRestart {
    fun restart(ctx: Context, beforeExit: () -> Unit = {}) {
        val app = ctx.applicationContext
        val launch = app.packageManager.getLaunchIntentForPackage(app.packageName)?.apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
        } ?: return
        runCatching { beforeExit() }
        runCatching { app.startActivity(launch) }
        Process.killProcess(Process.myPid())
    }
}
