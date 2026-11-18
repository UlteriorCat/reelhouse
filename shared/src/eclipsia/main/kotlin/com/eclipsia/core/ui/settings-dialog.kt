package com.eclipsia.core.ui

import android.app.Dialog
import android.content.Context
import android.view.KeyEvent
import android.view.View
import android.view.Window
import android.view.WindowInsets
import android.widget.LinearLayout

internal class SettingsDialog(ctx: Context) : Dialog(ctx, android.R.style.Theme_Material_NoActionBar) {
    var handleBack: () -> Unit = {}
    var onMenuKey: () -> Unit = {}

    init {
        window?.adjustResizeCompat()
    }

    override fun setContentView(view: View) {
        view.setOnApplyWindowInsetsListener { v, ins ->
            val base = systemInsets(ins)
            var l = base[0]
            var t = base[1]
            var r = base[2]
            var b = base[3]
            if (android.os.Build.VERSION.SDK_INT >= 28) {
                ins.displayCutout?.let {
                    l = maxOf(l, it.safeInsetLeft); t = maxOf(t, it.safeInsetTop)
                    r = maxOf(r, it.safeInsetRight); b = maxOf(b, it.safeInsetBottom)
                }
            }
            v.setPadding(l, t, r, b)
            ins
        }
        super.setContentView(view)
    }

    @Deprecated("Back is routed through handleBack for both the back key and the back gesture")
    override fun onBackPressed() {
        handleBack()
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.keyCode == KeyEvent.KEYCODE_MENU) {
            if (event.action == KeyEvent.ACTION_UP) onMenuKey()
            return true
        }
        return super.dispatchKeyEvent(event)
    }
}

private fun layoutMode(ctx: Context): Int =
    (if (isWideLayout(ctx)) 2 else 0) + (if (isFullSidebar(ctx)) 1 else 0)

internal fun SettingsDialog.rebuildOnLayoutChange(ctx: Context, reopen: () -> Unit) {
    val initial = layoutMode(ctx)
    val decor = window?.decorView ?: return
    decor.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ ->
        if (isShowing && layoutMode(ctx) != initial) {
            decor.post {
                if (isShowing) {
                    dismiss()
                    reopen()
                }
            }
        }
    }
}

internal fun settingsPageColumn(ctx: Context, wide: Boolean) = LinearLayout(ctx).apply {
    orientation = LinearLayout.VERTICAL
    val ph = if (wide) 12 else Sp.PAGE
    setPadding(dp(ctx, ph), dp(ctx, Sp.S), dp(ctx, ph), vGap(ctx, 0.03f, 16, 32))
}

@Suppress("DEPRECATION")
private fun systemInsets(ins: WindowInsets): IntArray =
    if (android.os.Build.VERSION.SDK_INT >= 30) {
        val i = ins.getInsets(
            WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout() or WindowInsets.Type.ime()
        )
        intArrayOf(i.left, i.top, i.right, i.bottom)
    } else {
        intArrayOf(
            ins.systemWindowInsetLeft, ins.systemWindowInsetTop,
            ins.systemWindowInsetRight, ins.systemWindowInsetBottom,
        )
    }

@Suppress("DEPRECATION")
internal fun Window.adjustResizeCompat() {
    setSoftInputMode(android.view.WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
}

@Suppress("DEPRECATION")
internal fun Window.setSystemBarColors(color: Int) {
    if (android.os.Build.VERSION.SDK_INT < 35) {
        statusBarColor = color
        navigationBarColor = color
    }
}
