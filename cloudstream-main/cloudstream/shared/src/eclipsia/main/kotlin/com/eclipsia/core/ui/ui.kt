package com.eclipsia.core.ui

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.text.InputType
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast

internal object Sp {
    const val XS = 4
    const val S = 8
    const val M = 12
    const val L = 16
    const val PAGE = 20
    const val XL = 24
    const val GAP = 16
    const val ROW_MIN = 66
    const val RADIUS = 20
    const val BTN_H = 50
    const val SHEET = 24
    const val ROW_H = 16
    const val CTRL_H = 48
}

internal object C {

    val BG = Color.parseColor("#000000")
    val CARD = Color.parseColor("#1A1B1D")
    val CARD_HIGH = Color.parseColor("#242628")
    val OUTLINE = Color.parseColor("#4C5A5E")
    val HAIRLINE = Color.argb(30, 255, 255, 255)
    val EDGE_STRONG = Color.argb(56, 255, 255, 255)
    val WELL = Color.parseColor("#1F2022")
    val TEXT = Color.parseColor("#D3DBDE")
    val TEXT_DIM = Color.parseColor("#8E9A9F")
    val TEXT_FAINT = Color.parseColor("#6A767B")
    val PRIMARY = Color.parseColor("#8DB3C0")
    val ON_PRIMARY = Color.parseColor("#071114")
    val TOGGLE_ON = Color.parseColor("#5E8795")
    val TOGGLE_OFF = Color.argb(46, 255, 255, 255)
    val THUMB_OFF = Color.parseColor("#8F9DA2")
    val THUMB_ON = Color.parseColor("#E4ECEF")
    val TONAL = Color.argb(30, 255, 255, 255)
    val ON_TONAL = Color.parseColor("#D3DBDE")
    val ICON = Color.parseColor("#8DAAB4")
    val SHEET = Color.parseColor("#1A1B1D")
}

internal class ToggleView(ctx: Context) : View(ctx) {
    var checked = false
        private set
    var onChange: ((Boolean) -> Unit)? = null
    private var progress = 0f
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val d = ctx.resources.displayMetrics.density

    init {
        isFocusable = false
        setOnClickListener { if (isEnabled) setChecked(!checked, true) }
    }

    fun setChecked(value: Boolean, animate: Boolean) {
        val changed = value != checked
        checked = value
        val target = if (value) 1f else 0f
        if (animate) ValueAnimator.ofFloat(progress, target).apply {
            duration = 180
            addUpdateListener { progress = it.animatedValue as Float; invalidate() }
        }.start() else {
            progress = target; invalidate()
        }
        if (changed) onChange?.invoke(value)
    }

    private fun mix(a: Int, b: Int, t: Float) = Color.argb(
        (Color.alpha(a) + (Color.alpha(b) - Color.alpha(a)) * t).toInt(),
        (Color.red(a) + (Color.red(b) - Color.red(a)) * t).toInt(),
        (Color.green(a) + (Color.green(b) - Color.green(a)) * t).toInt(),
        (Color.blue(a) + (Color.blue(b) - Color.blue(a)) * t).toInt()
    )

    override fun onDraw(c: Canvas) {
        val w = 48 * d
        val h = 28 * d
        val left = (width - w) / 2f
        val top = (height - h) / 2f
        val alpha = if (isEnabled) 255 else 90
        val rect = RectF(left, top, left + w, top + h)

        paint.style = Paint.Style.FILL
        paint.color = mix(C.TOGGLE_OFF, C.TOGGLE_ON, progress); paint.alpha = (Color.alpha(paint.color) * alpha / 255)
        c.drawRoundRect(rect, h / 2, h / 2, paint)
        paint.style = Paint.Style.STROKE; paint.strokeWidth = d
        paint.color = Color.argb(((1f - progress) * 26 * alpha / 255).toInt(), 255, 255, 255)
        val r = RectF(rect); r.inset(d / 2, d / 2)
        c.drawRoundRect(r, h / 2, h / 2, paint)

        val pad = 3 * d
        val radius = h / 2 - pad
        val cx = left + pad + radius + (w - 2 * pad - 2 * radius) * progress

        paint.style = Paint.Style.FILL
        paint.color = Color.argb(60 * alpha / 255, 0, 0, 0)
        c.drawCircle(cx, top + h / 2 + d, radius, paint)
        paint.color = mix(C.THUMB_OFF, C.THUMB_ON, progress); paint.alpha = alpha
        c.drawCircle(cx, top + h / 2, radius, paint)
    }
}

internal class GearView(ctx: Context) : View(ctx) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = C.TEXT_DIM; style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND
    }

    override fun onDraw(c: Canvas) {
        val s = minOf(width, height) / 24f * 0.62f
        c.save()
        c.translate((width - 24 * s) / 2f, (height - 24 * s) / 2f)
        c.scale(s, s)
        paint.strokeWidth = 1.9f

        c.drawLine(4f, 21f, 4f, 14f, paint); c.drawLine(4f, 10f, 4f, 3f, paint)
        c.drawLine(12f, 21f, 12f, 12f, paint); c.drawLine(12f, 8f, 12f, 3f, paint)
        c.drawLine(20f, 21f, 20f, 16f, paint); c.drawLine(20f, 12f, 20f, 3f, paint)

        paint.strokeWidth = 2.2f
        c.drawLine(1.5f, 12f, 6.5f, 12f, paint)
        c.drawLine(9.5f, 10f, 14.5f, 10f, paint)
        c.drawLine(17.5f, 14f, 22.5f, 14f, paint)
        c.restore()
    }
}

internal fun subPage(
    ctx: Context, title: String, subtitle: String, content: View,
    wide: Boolean = isWideLayout(ctx), onBack: () -> Unit,
): View = if (wide) pageScroll(ctx, content) else phoneSubPage(ctx, title, subtitle, content, onBack)

private fun phoneSubPage(ctx: Context, title: String, subtitle: String, content: View, onBack: () -> Unit): View {
    val scroll = ScrollView(ctx).apply { isVerticalScrollBarEnabled = false; addView(content) }
    val head = LinearLayout(ctx).apply {
        background = headerScrim(ctx)
        gravity = Gravity.CENTER_VERTICAL
        setPadding(dp(ctx, Sp.PAGE), vGap(ctx, 0.012f, 6, 16), dp(ctx, Sp.PAGE), dp(ctx, Sp.L))
        addView(BackButton(ctx, onBack), LinearLayout.LayoutParams(dp(ctx, 44), dp(ctx, 44)))
        addView(LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            addView(titleText(ctx, title, 24f))
            addView(text(ctx, subtitle, 13f, C.TEXT_DIM), lp(ctx, top = 4))
        }, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f).apply { leftMargin = dp(ctx, Sp.L) })
    }
    underHeader(head, scroll)
    return android.widget.FrameLayout(ctx).apply {
        addView(scroll, MATCH_PARENT, MATCH_PARENT)
        addView(head, android.widget.FrameLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT, Gravity.TOP))
    }
}

internal fun menuCard(ctx: Context, kind: IconView.Kind, tint: Int, title: String, sub: TextView, onClick: () -> Unit) =
    card(ctx).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        minimumHeight = dp(ctx, Sp.ROW_MIN + 8)
        setPadding(dp(ctx, Sp.L), dp(ctx, 14), dp(ctx, Sp.M), dp(ctx, 14))
        addView(IconView(ctx, kind, tint), LinearLayout.LayoutParams(dp(ctx, 44), dp(ctx, 44)))
        addView(LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            addView(text(ctx, title, 16f, C.TEXT, bold = true))
            addView(sub, lp(ctx, top = 4))
        }, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f).apply { leftMargin = dp(ctx, Sp.L) })
        addView(RightChevron(ctx), LinearLayout.LayoutParams(dp(ctx, 24), dp(ctx, 24)))
        setOnClickListener { onClick() }
        focusRing(ctx, this, Sp.RADIUS)
    }

internal fun settingCard(ctx: Context, title: String, desc: String, trailing: View) = card(ctx).apply {
    setPadding(dp(ctx, Sp.L), dp(ctx, 18), dp(ctx, Sp.L), dp(ctx, 18))
    addView(LinearLayout(ctx).apply {
        gravity = Gravity.CENTER_VERTICAL
        addView(text(ctx, title, 16f, C.TEXT, bold = true), LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f).apply { rightMargin = dp(ctx, Sp.M) })
        addView(trailing, LinearLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT))
    })
    addView(text(ctx, desc, 13f, C.TEXT_DIM).apply { setLineSpacing(0f, 1.25f) }, lp(ctx, top = 10))
}

internal fun toggleCard(ctx: Context, title: String, sub: String, toggle: ToggleView) = card(ctx).apply {
    orientation = LinearLayout.HORIZONTAL
    gravity = Gravity.CENTER_VERTICAL
    minimumHeight = dp(ctx, Sp.ROW_MIN)
    setPadding(dp(ctx, Sp.ROW_H), dp(ctx, 14), dp(ctx, 14), dp(ctx, 14))
    addView(LinearLayout(ctx).apply {
        orientation = LinearLayout.VERTICAL
        addView(text(ctx, title, 16f, C.TEXT, bold = true))
        if (sub.isNotBlank()) addView(text(ctx, sub, 13f, C.TEXT_DIM).apply { setLineSpacing(0f, 1.25f) }, lp(ctx, top = 4))
    }, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f).apply { rightMargin = dp(ctx, Sp.M) })
    addView(toggle, LinearLayout.LayoutParams(dp(ctx, 52), dp(ctx, 32)))
    rowFocus(ctx, this, toggle)
}

internal fun stepper(
    ctx: Context, value: TextView, valueWidthDp: Int, onMinus: () -> Unit, onPlus: () -> Unit,
    onValueClick: (() -> Unit)? = null,
): View {
    fun btn(label: String, click: () -> Unit) = TextView(ctx).apply {
        text = label; textSize = 24f; gravity = Gravity.CENTER
        typeface = Fonts.regular
        setTextColor(C.TEXT); includeFontPadding = false
        val handler = android.os.Handler(android.os.Looper.getMainLooper())
        var repeated = false
        var repeater: Runnable? = null
        fun stop() { repeater?.let { handler.removeCallbacks(it) }; repeater = null }
        fun startRepeat() {
            stop()
            val r = object : Runnable {
                override fun run() { repeated = true; click(); handler.postDelayed(this, 90) }
            }
            repeater = r
            handler.postDelayed(r, 450)
        }
        setOnClickListener { if (repeated) repeated = false else click() }

        setOnTouchListener { _, ev ->
            when (ev.actionMasked) {
                android.view.MotionEvent.ACTION_DOWN -> { repeated = false; startRepeat() }
                android.view.MotionEvent.ACTION_UP, android.view.MotionEvent.ACTION_CANCEL -> stop()
            }
            false
        }

        setOnKeyListener { _, code, ev ->
            val ok = code == KeyEvent.KEYCODE_DPAD_CENTER || code == KeyEvent.KEYCODE_ENTER ||
                code == KeyEvent.KEYCODE_NUMPAD_ENTER
            if (ok && ev.action == KeyEvent.ACTION_DOWN && ev.repeatCount > 0) {
                repeated = true; click(); true
            } else false
        }
        addOnAttachStateChangeListener(object : View.OnAttachStateChangeListener {
            override fun onViewAttachedToWindow(v: View) = Unit
            override fun onViewDetachedFromWindow(v: View) = stop()
        })
        focusRing(ctx, this, 20, 1.05f)
    }
    return LinearLayout(ctx).apply {
        gravity = Gravity.CENTER_VERTICAL
        background = GradientDrawable().apply { setColor(C.WELL); cornerRadius = dp(ctx, 24).toFloat(); setStroke(dp(ctx, 1), C.HAIRLINE) }
        setPadding(dp(ctx, 2), 0, dp(ctx, 2), 0)
        addView(btn("−", onMinus), LinearLayout.LayoutParams(dp(ctx, 44), dp(ctx, 40)))
        value.minWidth = dp(ctx, valueWidthDp)
        if (onValueClick != null) {
            value.setOnClickListener { onValueClick() }
            focusRing(ctx, value, 14, 1.05f)
        }
        addView(value)
        addView(btn("+", onPlus), LinearLayout.LayoutParams(dp(ctx, 44), dp(ctx, 40)))
    }
}

internal class IconView(ctx: Context, val kind: Kind, tintInit: Int, private val tile: Boolean = true) : View(ctx) {
    enum class Kind { BOLT, GRID, KEY, IMAGE, LIST, ALERT, DIAMOND, PLUG }
    private var tint = tintInit
    fun setTint(c: Int) { tint = c; invalidate() }
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val d = ctx.resources.displayMetrics.density

    init {
        if (tile) background = GradientDrawable().apply {
            setColor(Color.argb(30, Color.red(tint), Color.green(tint), Color.blue(tint)))
            cornerRadius = 13 * d
            setStroke(d.toInt().coerceAtLeast(1), C.HAIRLINE)
        }
    }

    override fun onDraw(c: Canvas) {
        val s = minOf(width, height) / 24f * 0.58f
        c.save()
        c.translate((width - 24 * s) / 2f, (height - 24 * s) / 2f)
        c.scale(s, s)
        paint.color = tint
        paint.style = Paint.Style.FILL
        when (kind) {
            Kind.BOLT -> {
                val p = Path().apply {
                    moveTo(13f, 2f); lineTo(4f, 14f); lineTo(11f, 14f)
                    lineTo(10f, 22f); lineTo(20f, 9.5f); lineTo(13f, 9.5f); close()
                }
                paint.strokeJoin = Paint.Join.ROUND
                paint.style = Paint.Style.FILL_AND_STROKE
                paint.strokeWidth = 1.2f
                c.drawPath(p, paint)
            }
            Kind.GRID -> {
                val r = 2.6f
                c.drawRoundRect(RectF(3f, 3f, 11f, 11f), r, r, paint)
                c.drawRoundRect(RectF(13f, 3f, 21f, 11f), r, r, paint)
                c.drawRoundRect(RectF(3f, 13f, 11f, 21f), r, r, paint)
                c.drawRoundRect(RectF(13f, 13f, 21f, 21f), r, r, paint)
            }
            Kind.KEY -> {
                paint.style = Paint.Style.STROKE
                paint.strokeWidth = 2.4f
                paint.strokeCap = Paint.Cap.ROUND
                c.drawCircle(8f, 15f, 4.5f, paint)
                c.drawLine(11.5f, 11.5f, 20f, 3f, paint)
                c.drawLine(17f, 6f, 20f, 9f, paint)
            }
            Kind.IMAGE -> {
                c.drawRoundRect(RectF(3f, 4f, 21f, 20f), 3f, 3f, paint.apply { style = Paint.Style.STROKE; strokeWidth = 2.2f })
                paint.style = Paint.Style.FILL
                c.drawCircle(8.5f, 9.5f, 1.8f, paint)
                val m = Path().apply { moveTo(4f, 18f); lineTo(10f, 12f); lineTo(14f, 16f); lineTo(16.5f, 13.5f); lineTo(20f, 17f); lineTo(20f, 19f); lineTo(4f, 19f); close() }
                c.drawPath(m, paint)
            }
            Kind.ALERT -> {
                paint.style = Paint.Style.STROKE
                paint.strokeWidth = 2.2f
                paint.strokeCap = Paint.Cap.ROUND
                c.drawCircle(12f, 12f, 9f, paint)
                c.drawLine(12f, 7.2f, 12f, 12.8f, paint)
                paint.style = Paint.Style.FILL
                c.drawCircle(12f, 16.6f, 1.4f, paint)
            }
            Kind.DIAMOND -> {

                fun shade(a: Int, lift: Float = 0f): Int {
                    val r = (Color.red(tint) + (255 - Color.red(tint)) * lift).toInt()
                    val g = (Color.green(tint) + (255 - Color.green(tint)) * lift).toInt()
                    val b = (Color.blue(tint) + (255 - Color.blue(tint)) * lift).toInt()
                    return Color.argb(a, r, g, b)
                }
                fun facet(color: Int, vararg pts: Float) {
                    paint.style = Paint.Style.FILL
                    paint.color = color
                    val p = Path().apply {
                        moveTo(pts[0], pts[1])
                        var i = 2
                        while (i < pts.size) { lineTo(pts[i], pts[i + 1]); i += 2 }
                        close()
                    }
                    c.drawPath(p, paint)
                }

                facet(shade(255, 0.45f), 7f, 3.5f, 17f, 3.5f, 15.2f, 9f, 8.8f, 9f)
                facet(shade(235, 0.15f), 7f, 3.5f, 8.8f, 9f, 2f, 9f)
                facet(shade(170), 17f, 3.5f, 22f, 9f, 15.2f, 9f)
                facet(shade(215, 0.2f), 8.8f, 9f, 15.2f, 9f, 12f, 21f)
                facet(shade(150), 2f, 9f, 8.8f, 9f, 12f, 21f)
                facet(shade(105), 15.2f, 9f, 22f, 9f, 12f, 21f)

                paint.color = Color.argb(110, 255, 255, 255)
                c.drawPath(Path().apply { moveTo(9f, 4.6f); lineTo(12f, 4.6f); lineTo(11f, 7.8f); lineTo(9.3f, 7.8f); close() }, paint)
                paint.color = tint
            }
            Kind.PLUG -> {
                paint.style = Paint.Style.STROKE
                paint.strokeWidth = 2.2f
                paint.strokeCap = Paint.Cap.ROUND
                paint.strokeJoin = Paint.Join.ROUND
                c.drawLine(9f, 3f, 9f, 7.5f, paint)
                c.drawLine(15f, 3f, 15f, 7.5f, paint)
                c.drawRoundRect(RectF(5.5f, 7.5f, 18.5f, 14f), 3f, 3f, paint)
                c.drawPath(Path().apply { moveTo(12f, 14f); lineTo(12f, 17f); quadTo(12f, 20.5f, 15.5f, 20.5f); lineTo(18.5f, 20.5f) }, paint)
            }
            Kind.LIST -> {
                val r = 1.6f
                for (y in listOf(6f, 12f, 18f)) {
                    c.drawRoundRect(RectF(3f, y - 1.6f, 6.2f, y + 1.6f), r, r, paint)
                    c.drawRoundRect(RectF(9f, y - 1.3f, 21f, y + 1.3f), r, r, paint)
                }
            }
        }
        c.restore()
    }
}

internal class BackButton(ctx: Context, onClick: () -> Unit) : View(ctx) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
        strokeWidth = 2.4f
        color = C.TEXT
    }

    init {
        background = GradientDrawable().apply {
            shape = GradientDrawable.OVAL; setColor(C.TONAL)
            setStroke(dp(ctx, 1), C.HAIRLINE)
        }
        setOnClickListener { onClick() }
        focusRing(ctx, this, 22, 1.08f)
    }

    override fun onDraw(c: Canvas) {
        val s = minOf(width, height) / 24f * 0.6f
        c.save()
        c.translate((width - 24 * s) / 2f, (height - 24 * s) / 2f)
        c.scale(s, s)
        c.drawPath(Path().apply { moveTo(14.5f, 5f); lineTo(7.5f, 12f); lineTo(14.5f, 19f) }, paint)
        c.restore()
    }
}

internal class RightChevron(ctx: Context) : View(ctx) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
        strokeWidth = 2.2f
        color = C.OUTLINE
    }

    override fun onDraw(c: Canvas) {
        val s = minOf(width, height) / 24f * 0.6f
        c.save()
        c.translate((width - 24 * s) / 2f, (height - 24 * s) / 2f)
        c.scale(s, s)
        c.drawPath(Path().apply { moveTo(9.5f, 5f); lineTo(16.5f, 12f); lineTo(9.5f, 19f) }, paint)
        c.restore()
    }
}

internal class ChevronButton(ctx: Context, up: Boolean, onClick: () -> Unit) : View(ctx) {
    var up: Boolean = up
        set(v) { field = v; invalidate() }
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
        strokeWidth = 2.4f
        color = C.TEXT_DIM
    }

    init {
        setOnClickListener { onClick() }
        focusRing(ctx, this, 12, 1.05f)
    }

    override fun onDraw(c: Canvas) {
        val s = minOf(width, height) / 24f * 0.6f
        c.save()
        c.translate((width - 24 * s) / 2f, (height - 24 * s) / 2f)
        c.scale(s, s)
        val path = Path().apply {
            if (up) { moveTo(5f, 15.5f); lineTo(12f, 8.5f); lineTo(19f, 15.5f) }
            else { moveTo(5f, 8.5f); lineTo(12f, 15.5f); lineTo(19f, 8.5f) }
        }
        c.drawPath(path, paint)
        c.restore()
    }
}

internal fun ringDrawable(ctx: Context, radiusDp: Int) = GradientDrawable().apply {
    setColor(Color.argb(22, 255, 255, 255))
    cornerRadius = dp(ctx, radiusDp).toFloat()
    setStroke(dp(ctx, 2), Color.WHITE)
}

internal fun focusRing(ctx: Context, v: View, radiusDp: Int, scale: Float = 1.015f) {
    v.isFocusable = true
    val ring = ringDrawable(ctx, radiusDp)
    v.setOnFocusChangeListener { view, has ->
        if (Build.VERSION.SDK_INT >= 23) view.foreground = if (has) ring else null
        val w = view.width
        val capped = if (w > 0) minOf(scale, 1f + dp(ctx, 10).toFloat() / w) else scale
        val target = if (has) capped else 1f
        view.animate().scaleX(target).scaleY(target).setDuration(120).start()
    }
}

internal fun rowFocus(ctx: Context, row: View, toggle: ToggleView, radiusDp: Int = 14) {
    focusRing(ctx, row, radiusDp)
    row.setOnClickListener { toggle.performClick() }
}

internal fun dp(ctx: Context, v: Int) = (v * ctx.resources.displayMetrics.density).toInt()

internal fun vGap(ctx: Context, fraction: Float, minDp: Int, maxDp: Int): Int {
    val dm = ctx.resources.displayMetrics
    return (dm.heightPixels * fraction).toInt().coerceIn(dp(ctx, minDp), dp(ctx, maxDp))
}

internal fun lp(ctx: Context, top: Int = 0) = LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply {
    topMargin = dp(ctx, top)
}

internal fun text(ctx: Context, s: String, size: Float, color: Int, bold: Boolean = false) = TextView(ctx).apply {
    text = s; textSize = size; setTextColor(color)
    typeface = if (bold) Fonts.medium else Fonts.regular
}

internal fun titleText(ctx: Context, s: String, size: Float) = TextView(ctx).apply {
    text = s; textSize = size; setTextColor(C.TEXT)
    typeface = Fonts.bold
}

internal fun brandText(ctx: Context, s: String, size: Float) = TextView(ctx).apply {
    text = s; textSize = size; setTextColor(C.TEXT)
    typeface = Fonts.bold
}

internal fun sectionLabel(ctx: Context, s: String, first: Boolean = false) = text(ctx, s.uppercase(), 12f, C.TEXT_DIM).apply {
    typeface = Fonts.bold
    if (Build.VERSION.SDK_INT >= 21) letterSpacing = 0.09f
    setPadding(dp(ctx, Sp.S), dp(ctx, if (first) Sp.XS else Sp.XL), dp(ctx, Sp.S), dp(ctx, Sp.S))
}

internal fun card(ctx: Context) = LinearLayout(ctx).apply {
    orientation = LinearLayout.VERTICAL
    background = glassBg(ctx, Sp.RADIUS)
}

internal fun glassBg(ctx: Context, radiusDp: Int): android.graphics.drawable.Drawable =
    GradientDrawable().apply {
        setColor(C.CARD)
        cornerRadius = dp(ctx, radiusDp).toFloat()
        setStroke(dp(ctx, 1), C.HAIRLINE)
    }

internal fun glassPanel(ctx: Context, radiusDp: Int): android.graphics.drawable.Drawable =
    GradientDrawable().apply {
        setColor(C.CARD_HIGH)
        cornerRadius = dp(ctx, radiusDp).toFloat()
        setStroke(dp(ctx, 1), C.HAIRLINE)
    }

internal fun headerScrim(ctx: Context): android.graphics.drawable.Drawable {
    val fill = GradientDrawable().apply { setColor(C.BG) }
    if (Build.VERSION.SDK_INT < 23) return fill
    val line = GradientDrawable().apply { setColor(C.HAIRLINE) }
    return android.graphics.drawable.LayerDrawable(arrayOf<android.graphics.drawable.Drawable>(fill, line)).apply {
        setLayerHeight(1, dp(ctx, 1)); setLayerGravity(1, Gravity.BOTTOM)
    }
}

internal fun aboveDock(dock: View, pages: List<View>) {
    fun scrolls(v: View, out: MutableList<ScrollView>) {
        if (v is ScrollView) out.add(v)
        else if (v is android.view.ViewGroup) for (i in 0 until v.childCount) scrolls(v.getChildAt(i), out)
    }
    val all = ArrayList<ScrollView>()
    pages.forEach { scrolls(it, all) }
    dock.addOnLayoutChangeListener { _, _, t, _, bt, _, _, _, _ ->

        val h = (bt - t - dock.paddingTop + dp(dock.context, Sp.L)).coerceAtLeast(0)
        all.forEach {
            it.clipToPadding = false
            if (it.paddingBottom != h) it.setPadding(it.paddingLeft, it.paddingTop, it.paddingRight, h)
        }
    }
}

internal fun underHeader(header: View, vararg scrolls: View) {
    header.addOnLayoutChangeListener { _, _, t, _, b, _, _, _, _ ->
        val h = b - t
        scrolls.forEach {
            (it as? android.view.ViewGroup)?.clipToPadding = false
            if (it.paddingTop != h) it.setPadding(it.paddingLeft, h, it.paddingRight, it.paddingBottom)
        }
    }
}

internal fun ambientBg(): android.graphics.drawable.Drawable = ColorDrawable(C.BG)

internal fun chip(ctx: Context, label: String, selected: Boolean = false, onClick: () -> Unit): TextView = TextView(ctx).apply {
    text = label; textSize = 13.5f; gravity = Gravity.CENTER
    typeface = Fonts.medium
    setPadding(dp(ctx, 18), 0, dp(ctx, 18), 0)
    setChipSelected(this, selected)
    setOnClickListener { onClick() }
    focusRing(ctx, this, 18, 1.03f)
}

internal fun setChipSelected(chip: TextView, selected: Boolean) {
    val ctx = chip.context
    chip.setTextColor(if (selected) C.TEXT else C.TEXT_DIM)
    chip.background = GradientDrawable().apply {
        cornerRadius = dp(ctx, 18).toFloat()
        setColor(if (selected) Color.argb(54, 141, 179, 192) else Color.argb(24, 255, 255, 255))
        setStroke(dp(ctx, 1), if (selected) Color.argb(130, 141, 179, 192) else C.HAIRLINE)
    }
}

internal fun keyHint(ctx: Context, key: String, action: String): View = LinearLayout(ctx).apply {
    gravity = Gravity.CENTER_VERTICAL
    addView(text(ctx, key, 11f, C.TEXT, bold = true).apply {
        setPadding(dp(ctx, 8), dp(ctx, 3), dp(ctx, 8), dp(ctx, 3))
        background = GradientDrawable().apply { setColor(Color.argb(30, 255, 255, 255)); cornerRadius = dp(ctx, 6).toFloat() }
    })
    addView(text(ctx, action, 12f, C.TEXT_FAINT), LinearLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT).apply { leftMargin = dp(ctx, 8) })
}

internal fun topDivider(ctx: Context): android.graphics.drawable.Drawable? {
    if (Build.VERSION.SDK_INT < 23) return null
    val line = GradientDrawable().apply { setColor(C.HAIRLINE) }
    return android.graphics.drawable.LayerDrawable(arrayOf<android.graphics.drawable.Drawable>(line)).apply {
        setLayerHeight(0, dp(ctx, 1))
        setLayerGravity(0, Gravity.TOP)
        setLayerInsetLeft(0, dp(ctx, Sp.L))
        setLayerInsetRight(0, dp(ctx, Sp.L))
    }
}

internal fun group(ctx: Context, rows: List<View>): View = card(ctx).apply {
    rows.forEachIndexed { i, r ->
        r.background = if (i == 0) null else topDivider(ctx)
        addView(r, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
    }
}

internal fun regroup(ctx: Context, parent: LinearLayout, fromIndex: Int) {
    val rows = (fromIndex until parent.childCount).map { parent.getChildAt(it) }
    if (rows.size < 2) return
    parent.removeViews(fromIndex, rows.size)
    parent.addView(group(ctx, rows), lp(ctx, top = 0))
}

internal fun pageScroll(ctx: Context, content: View): View =
    ScrollView(ctx).apply { isVerticalScrollBarEnabled = false; clipToPadding = false; addView(content) }

internal fun divider(ctx: Context) = View(ctx).apply { setBackgroundColor(C.HAIRLINE) }

internal fun fieldCard(ctx: Context, child: View) = LinearLayout(ctx).apply {
    orientation = LinearLayout.VERTICAL
    background = GradientDrawable().apply {
        setColor(C.WELL); cornerRadius = dp(ctx, 16).toFloat()
        setStroke(dp(ctx, 1), C.HAIRLINE)
    }
    setPadding(dp(ctx, Sp.L), dp(ctx, Sp.M), dp(ctx, Sp.L), dp(ctx, Sp.M))
    addView(child, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
    if (child is EditText) {
        val ring = ringDrawable(ctx, 16)
        child.setOnFocusChangeListener { _, has ->
            if (Build.VERSION.SDK_INT >= 23) foreground = if (has) ring else null
        }
    }
}

internal fun button(ctx: Context, label: String, filled: Boolean, compact: Boolean = false, onClick: () -> Unit) =
    TextView(ctx).apply {
        text = label; textSize = 14.5f; gravity = Gravity.CENTER
        typeface = Fonts.bold
        setTextColor(if (filled) C.ON_PRIMARY else C.ON_TONAL)
        background = GradientDrawable().apply {
            setColor(if (filled) C.PRIMARY else C.TONAL); cornerRadius = dp(ctx, 28).toFloat()
            if (!filled) setStroke(dp(ctx, 1), C.EDGE_STRONG)
        }
        if (compact) setPadding(dp(ctx, 24), 0, dp(ctx, 24), 0)
        setOnClickListener { onClick() }
        focusRing(ctx, this, 28, 1.03f)
    }

internal fun textButton(ctx: Context, label: String, onClick: () -> Unit) = TextView(ctx).apply {
    text = label; textSize = 14f; setTextColor(C.PRIMARY)
    typeface = Fonts.bold
    setPadding(dp(ctx, 10), dp(ctx, 8), dp(ctx, 10), dp(ctx, 8))
    setOnClickListener { onClick() }
    focusRing(ctx, this, 12, 1.05f)
}

internal fun toast(ctx: Context, msg: String) = Toast.makeText(ctx, msg, Toast.LENGTH_SHORT).show()

internal val DANGER = Color.parseColor("#D0786F")
internal val WARN = Color.parseColor("#CFA862")

internal fun isTv(ctx: Context): Boolean =
    (ctx.getSystemService(Context.UI_MODE_SERVICE) as? android.app.UiModeManager)?.currentModeType ==
        android.content.res.Configuration.UI_MODE_TYPE_TELEVISION

internal fun editedText(base: String, edited: Boolean): CharSequence {
    if (!edited) return base
    val s = android.text.SpannableString("$base  \u2022  Edited")
    s.setSpan(
        android.text.style.ForegroundColorSpan(WARN), base.length, s.length,
        android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE
    )
    return s
}

internal fun fingerprint(v: View, sb: StringBuilder = StringBuilder()): String {
    if ("nofp" == v.tag) return sb.toString()
    when (v) {
        is ToggleView -> sb.append(if (v.checked) "T" else "F").append('|')
        is TextView -> sb.append(v.text).append('#').append(v.currentTextColor).append('|')
        is android.view.ViewGroup -> for (i in 0 until v.childCount) fingerprint(v.getChildAt(i), sb)
        else -> Unit
    }
    return sb.toString()
}

internal class SegmentedTabs(
    ctx: Context, labels: List<String>, private val onSelect: (Int) -> Unit,
) : android.widget.FrameLayout(ctx) {
    private val pad = dp(ctx, 4)
    private val pill = View(ctx).apply {
        background = GradientDrawable().apply { setColor(C.PRIMARY); cornerRadius = dp(ctx, 22).toFloat() }
    }
    private val items = ArrayList<TextView>()
    private var index = 0
    private var laidOut = false

    init {
        background = GradientDrawable().apply {
            setColor(C.WELL); cornerRadius = dp(ctx, 26).toFloat(); setStroke(dp(ctx, 1), C.HAIRLINE)
        }
        setPadding(pad, pad, pad, pad)
        addView(pill, android.widget.FrameLayout.LayoutParams(0, dp(ctx, 40)))
        val row = LinearLayout(ctx)
        labels.forEachIndexed { i, label ->
            val t = TextView(ctx).apply {
                text = label; textSize = 14.5f; gravity = Gravity.CENTER
                typeface = Fonts.bold
                setOnClickListener { onSelect(i) }
                focusRing(ctx, this, 22, 1f)
            }
            items += t
            row.addView(t, LinearLayout.LayoutParams(0, dp(ctx, 40), 1f))
        }
        addView(row, android.widget.FrameLayout.LayoutParams(MATCH_PARENT, dp(ctx, 40)))
        addOnLayoutChangeListener { _, l, _, r, _, _, _, _, _ ->
            val w = (r - l - pad * 2) / labels.size
            if (w > 0 && pill.layoutParams.width != w) {
                pill.layoutParams = (pill.layoutParams as android.widget.FrameLayout.LayoutParams).apply { width = w }
                pill.translationX = (w * index).toFloat()
            }
            laidOut = w > 0
        }
        select(0, false)
    }

    fun select(i: Int, animate: Boolean = true) {
        index = i
        items.forEachIndexed { idx, t -> t.setTextColor(if (idx == i) C.ON_PRIMARY else C.TEXT_DIM) }
        val target = (pill.layoutParams.width * i).toFloat()
        if (animate && laidOut) pill.animate().translationX(target).setDuration(180)
            .setInterpolator(android.view.animation.DecelerateInterpolator()).start()
        else pill.translationX = target
    }
}

internal enum class SheetStyle { PRIMARY, TONAL, DANGER }
internal class SheetAction(val label: String, val style: SheetStyle, val onClick: () -> Unit)

internal fun blurSheet(
    ctx: Context,
    backdrop: View,
    kind: IconView.Kind,
    tint: Int,
    title: String,
    message: String,
    actions: List<SheetAction>,
    focusIndex: Int = 0,
) {
    val dialog = android.app.Dialog(ctx, android.R.style.Theme_Translucent_NoTitleBar)
    val dm = ctx.resources.displayMetrics
    var closing = false

    val card = LinearLayout(ctx).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER_HORIZONTAL
        background = GradientDrawable().apply {
            setColor(C.SHEET); cornerRadius = dp(ctx, 28).toFloat()
            setStroke(dp(ctx, 1), Color.argb(40, 255, 255, 255))
        }
        setPadding(dp(ctx, Sp.SHEET), dp(ctx, 28), dp(ctx, Sp.SHEET), dp(ctx, Sp.SHEET))
        isClickable = true
        if (Build.VERSION.SDK_INT >= 21) elevation = dp(ctx, 16).toFloat()
    }
    card.addView(IconView(ctx, kind, tint), LinearLayout.LayoutParams(dp(ctx, 56), dp(ctx, 56)))
    card.addView(text(ctx, title, 22f, C.TEXT, bold = true).apply { gravity = Gravity.CENTER }, lp(ctx, top = 18))
    card.addView(
        text(ctx, message, 15f, C.TEXT_DIM).apply { gravity = Gravity.CENTER; setLineSpacing(0f, 1.2f) },
        lp(ctx, top = 8)
    )

    fun close(then: (() -> Unit)? = null) {
        if (closing) return
        closing = true
        card.animate().scaleX(0.94f).scaleY(0.94f).alpha(0f).setDuration(120).start()
        card.rootView.animate().alpha(0f).setDuration(140).withEndAction {
            dialog.dismiss(); then?.invoke()
        }.start()
    }

    val buttons = actions.mapIndexed { i, a ->
        val b = button(ctx, a.label, filled = a.style == SheetStyle.PRIMARY) { close(a.onClick) }
        if (a.style == SheetStyle.DANGER) {
            b.setTextColor(DANGER)
            (b.background as GradientDrawable).setColor(Color.argb(38, Color.red(DANGER), Color.green(DANGER), Color.blue(DANGER)))
        }
        b
    }
    card.addView(buttons[0], LinearLayout.LayoutParams(MATCH_PARENT, dp(ctx, 52)).apply { topMargin = dp(ctx, 24) })
    if (buttons.size > 1) {
        card.addView(LinearLayout(ctx).apply {
            buttons.drop(1).forEachIndexed { i, b ->
                addView(b, LinearLayout.LayoutParams(0, dp(ctx, 52), 1f).apply {
                    if (i > 0) leftMargin = dp(ctx, 6)
                    if (i < buttons.size - 2) rightMargin = dp(ctx, 6)
                })
            }
        }, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { topMargin = dp(ctx, Sp.M) })
    }

    val cardW = minOf(dm.widthPixels - dp(ctx, 48), dp(ctx, if (isTv(ctx)) 440 else 360))
    val cardScroll = object : ScrollView(ctx) {
        override fun onMeasure(w: Int, h: Int) =
            super.onMeasure(w, View.MeasureSpec.makeMeasureSpec(dm.heightPixels - dp(ctx, 32), View.MeasureSpec.AT_MOST))
    }.apply {
        isVerticalScrollBarEnabled = false
        clipToPadding = false
        clipChildren = false
        addView(card, android.widget.FrameLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
    }
    val root = android.widget.FrameLayout(ctx).apply {
        setOnClickListener { close() }
        addView(cardScroll, android.widget.FrameLayout.LayoutParams(cardW, WRAP_CONTENT, Gravity.CENTER))
    }

    dialog.setContentView(root)
    dialog.setOnKeyListener { _, code, ev ->
        if ((code == KeyEvent.KEYCODE_BACK || code == KeyEvent.KEYCODE_ESCAPE) && ev.action == KeyEvent.ACTION_UP) {
            close(); true
        } else false
    }
    dialog.window?.apply {
        setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
        setLayout(MATCH_PARENT, MATCH_PARENT)
        applyModalBackdrop(ctx, this, root, backdrop)
    }
    dialog.show()

    root.alpha = 0f
    card.scaleX = 0.92f; card.scaleY = 0.92f; card.translationY = dp(ctx, 12).toFloat()
    root.animate().alpha(1f).setDuration(160).start()
    card.animate().scaleX(1f).scaleY(1f).translationY(0f).setDuration(200)
        .setInterpolator(android.view.animation.DecelerateInterpolator()).start()
    buttons[focusIndex.coerceIn(0, buttons.lastIndex)].requestFocus()
}

internal fun unsavedChangesDialog(ctx: Context, backdrop: View, onSave: () -> Unit, onDiscard: () -> Unit) =
    blurSheet(
        ctx, backdrop, IconView.Kind.ALERT, WARN,
        "Unsaved changes",
        "You changed some settings. Save them before leaving, or they'll be lost.",
        listOf(
            SheetAction("Save changes", SheetStyle.PRIMARY, onSave),
            SheetAction("Keep editing", SheetStyle.TONAL) {},
            SheetAction("Discard", SheetStyle.DANGER, onDiscard),
        ),
    )

private const val MODAL_DIM = 0.08f

internal fun applyModalBackdrop(ctx: Context, window: android.view.Window, root: View, source: View?) {
    val wm = ctx.getSystemService(Context.WINDOW_SERVICE) as android.view.WindowManager
    val realBlur = Build.VERSION.SDK_INT >= 31 && wm.isCrossWindowBlurEnabled
    if (realBlur) {
        window.addFlags(android.view.WindowManager.LayoutParams.FLAG_BLUR_BEHIND or android.view.WindowManager.LayoutParams.FLAG_DIM_BEHIND)
        window.attributes = window.attributes.apply { blurBehindRadius = 28; dimAmount = MODAL_DIM }
        return
    }

    window.clearFlags(android.view.WindowManager.LayoutParams.FLAG_DIM_BEHIND)
    root.background = (source?.let { frostedBackdrop(ctx, it) }) ?: ColorDrawable(Color.argb((MODAL_DIM * 255).toInt(), 0, 0, 0))
}

internal fun frostedBackdrop(ctx: Context, source: View): android.graphics.drawable.Drawable? {
    val w0 = source.width; val h0 = source.height
    if (w0 <= 0 || h0 <= 0) return null
    return runCatching {

        val s1 = 1f / 6f
        val mid = android.graphics.Bitmap.createBitmap(
            (w0 * s1).toInt().coerceAtLeast(1), (h0 * s1).toInt().coerceAtLeast(1), android.graphics.Bitmap.Config.ARGB_8888
        )
        Canvas(mid).apply { drawColor(C.BG); scale(s1, s1); source.draw(this) }
        val small = android.graphics.Bitmap.createScaledBitmap(
            mid, (mid.width / 3).coerceAtLeast(1), (mid.height / 3).coerceAtLeast(1), true
        )
        mid.recycle()
        val bd = android.graphics.drawable.BitmapDrawable(ctx.resources, small).apply { isFilterBitmap = true }
        android.graphics.drawable.LayerDrawable(arrayOf(bd, ColorDrawable(Color.argb((MODAL_DIM * 255).toInt(), 0, 0, 0))))
    }.getOrNull()
}

internal const val DONATE_URL = "https://coinsend.to/@eclipsia"
internal val SUPPORT_PINK = Color.parseColor("#9DBAC4")

internal fun supportCard(ctx: Context): View = menuCard(
    ctx, IconView.Kind.DIAMOND, SUPPORT_PINK,
    "Support the project",
    text(ctx, "Help keep it free and updated", 13f, C.TEXT_DIM),
) {
    openDonate(ctx)
}

internal fun openDonate(ctx: Context) {
    runCatching {
        ctx.startActivity(
            android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(DONATE_URL))
                .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
        )
    }.onFailure { toast(ctx, "Couldn't open the link") }
}

internal fun screenWidthDp(ctx: Context): Int {
    val dm = ctx.resources.displayMetrics
    return (dm.widthPixels / dm.density).toInt()
}

internal fun screenHeightDp(ctx: Context): Int {
    val dm = ctx.resources.displayMetrics
    return (dm.heightPixels / dm.density).toInt()
}

internal fun isWideLayout(ctx: Context): Boolean =
    isTv(ctx) || (screenWidthDp(ctx) >= 600 && screenHeightDp(ctx) >= 480)

internal fun isFullSidebar(ctx: Context): Boolean = isTv(ctx) || screenWidthDp(ctx) >= 900

internal class NavEntry(val page: Int, val kind: IconView.Kind, val label: String, val title: String, val subtitle: String)

internal class NavItem(
    ctx: Context, kind: IconView.Kind, private val label: String, private val full: Boolean,
    private val idleTint: Int = C.TEXT_DIM, onClick: () -> Unit,
) : LinearLayout(ctx) {
    private val icon = IconView(ctx, kind, idleTint, tile = false)
    private val labelView = text(ctx, label, 14f, C.TEXT_DIM).apply { typeface = Fonts.medium }
    private val dot = View(ctx).apply {
        background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(WARN) }
        visibility = View.GONE
    }
    private var sel = false
    private var edited = false

    init {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        minimumHeight = dp(ctx, if (full) 46 else 52)
        contentDescription = label
        val pad = if (full) dp(ctx, 12) else 0
        setPadding(pad, 0, pad, 0)
        if (full) {
            addView(icon, LinearLayout.LayoutParams(dp(ctx, 24), dp(ctx, 24)))
            addView(labelView, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f).apply { leftMargin = dp(ctx, 12) })
            addView(dot, LinearLayout.LayoutParams(dp(ctx, 8), dp(ctx, 8)))
        } else {
            gravity = Gravity.CENTER
            addView(icon, LinearLayout.LayoutParams(dp(ctx, 24), dp(ctx, 24)))
        }
        setOnClickListener { onClick() }
        focusRing(ctx, this, 16, 1.02f)
        refresh()
    }

    private fun refresh() {
        background = if (sel) GradientDrawable().apply { setColor(Color.argb(40, 141, 179, 192)); cornerRadius = dp(context, 16).toFloat(); setStroke(dp(context, 1), C.HAIRLINE) } else null
        labelView.setTextColor(if (sel) C.TEXT else C.TEXT_DIM)
        icon.setTint(
            when {
                sel -> C.TEXT
                edited && !full -> WARN
                else -> idleTint
            }
        )
        dot.visibility = if (edited && full) View.VISIBLE else View.GONE
    }

    fun mark(selected: Boolean) { if (sel != selected) { sel = selected; refresh() } }
    fun setEdited(on: Boolean) { if (edited != on) { edited = on; refresh() } }
}

internal class WideShell(
    private val ctx: Context,
    brand: String,
    brandSub: TextView,
    dirtyChip: TextView,
    private val entries: List<NavEntry>,
    pageViews: Map<Int, View>,
    cancelBtn: TextView,
    saveBtn: TextView,
    onSupport: () -> Unit,
) {
    private val full = isFullSidebar(ctx)
    private val items = LinkedHashMap<Int, NavItem>()
    private val title = titleText(ctx, "", 24f).apply {
        maxLines = 1
        ellipsize = android.text.TextUtils.TruncateAt.END
    }
    private val sub = text(ctx, "", 13f, C.TEXT_DIM)
    private val frame = android.widget.FrameLayout(ctx)
    private val column = LinearLayout(ctx)
    private val pageMap = pageViews
    val root = LinearLayout(ctx)
    var current = -1
        private set

    init {
        val dm = ctx.resources.displayMetrics
        val sideW = dp(ctx, if (full) 236 else 76)
        val edge = dp(ctx, 16)
        val toContent = View.OnKeyListener { _, code, ev ->
            if (code != KeyEvent.KEYCODE_DPAD_RIGHT) return@OnKeyListener false
            if (ev.action != KeyEvent.ACTION_DOWN) return@OnKeyListener true
            val found = ArrayList<View>()
            pageMap[current]?.addFocusables(found, View.FOCUS_RIGHT)
            val target = found.firstOrNull { it.isShown && it.isFocusable }
            target?.requestFocus()
            target != null
        }
        val side = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            background = glassPanel(ctx, 28)
            val h = dp(ctx, if (full) 12 else 10)
            setPadding(h, vGap(ctx, 0.012f, 8, 20), h, dp(ctx, 18))
        }
        val nav = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }
        if (full) {
            side.addView(LinearLayout(ctx).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(ctx, 12), 0, dp(ctx, 12), dp(ctx, 20))
                addView(brandText(ctx, brand, 26f))
                addView(brandSub.apply { textSize = 13f }, lp(ctx, top = 6))
            })
        } else {
            side.addView(View(ctx), LinearLayout.LayoutParams(MATCH_PARENT, dp(ctx, 8)))
        }

        nav.addView(
            NavItem(ctx, IconView.Kind.DIAMOND, if (full) "Support the project" else "Support", full, SUPPORT_PINK) { onSupport() }
                .apply { setOnKeyListener(toContent) },
            LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT)
        )
        if (full) nav.addView(divider(ctx), LinearLayout.LayoutParams(MATCH_PARENT, dp(ctx, 1)).apply {
            topMargin = dp(ctx, 12); bottomMargin = dp(ctx, 4); leftMargin = dp(ctx, 12); rightMargin = dp(ctx, 12)
        }) else nav.addView(
            divider(ctx),
            LinearLayout.LayoutParams(dp(ctx, 28), dp(ctx, 1)).apply {
                gravity = Gravity.CENTER_HORIZONTAL; topMargin = dp(ctx, 8); bottomMargin = dp(ctx, 4)
            }
        )
        val labelAt = entries.indexOfFirst { it.page > 0 }
        entries.forEachIndexed { idx, e ->
            if (idx == labelAt) {
                if (full) nav.addView(sectionLabel(ctx, "Settings").apply {
                    setPadding(dp(ctx, 12), dp(ctx, 20), 0, dp(ctx, 8))
                }) else nav.addView(
                    divider(ctx),
                    LinearLayout.LayoutParams(dp(ctx, 28), dp(ctx, 1)).apply {
                        gravity = Gravity.CENTER_HORIZONTAL; topMargin = dp(ctx, 8); bottomMargin = dp(ctx, 8)
                    }
                )
            }
            val item = NavItem(ctx, e.kind, e.label, full) { select(e.page, focus = false) }
            item.setOnKeyListener(toContent)
            items[e.page] = item
            nav.addView(item, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { topMargin = dp(ctx, 4) })
        }
        side.addView(
            ScrollView(ctx).apply {
                isVerticalScrollBarEnabled = false
                overScrollMode = View.OVER_SCROLL_NEVER
                isFillViewport = false
                addView(nav, android.widget.FrameLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
            },
            LinearLayout.LayoutParams(MATCH_PARENT, 0, 1f)
        )

        val bar = LinearLayout(ctx).apply {
            gravity = Gravity.CENTER_VERTICAL
            background = glassPanel(ctx, 22)
            setPadding(dp(ctx, 22), dp(ctx, 12), dp(ctx, 12), dp(ctx, 12))
            addView(LinearLayout(ctx).apply {
                orientation = LinearLayout.VERTICAL
                addView(title)
                addView(sub, lp(ctx, top = 2))
                if (!full) addView(brandSub.apply { textSize = 12f }, lp(ctx, top = 2))
            }, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f))
            addView(dirtyChip.apply {
                setPadding(0, 0, dp(ctx, 8), 0)
                if (screenWidthDp(ctx) < 700) { text = "●"; contentDescription = "Unsaved changes" }
            })
            listOf(cancelBtn, saveBtn).forEach { b ->
                b.setPadding(dp(ctx, 26), 0, dp(ctx, 26), 0)
                addView(b, LinearLayout.LayoutParams(WRAP_CONTENT, dp(ctx, 42)).apply { leftMargin = dp(ctx, 10) })
            }
        }
        pageMap.values.forEach { frame.addView(it, MATCH_PARENT, MATCH_PARENT) }
        column.apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(ctx, 10), dp(ctx, 36), dp(ctx, 10), 0)
            addView(bar, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { bottomMargin = dp(ctx, 20) })
            addView(frame, LinearLayout.LayoutParams(MATCH_PARENT, 0, 1f))
            if (isTv(ctx)) addView(
                LinearLayout(ctx).apply {
                    gravity = Gravity.CENTER
                    setPadding(0, dp(ctx, 14), 0, dp(ctx, 22))
                    listOf("OK" to "Select", "MENU" to "Focus Save", "BACK" to "Sidebar / close").forEachIndexed { i, (k, a) ->
                        addView(keyHint(ctx, k, a), LinearLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT).apply { if (i > 0) leftMargin = dp(ctx, 28) })
                    }
                }, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT)
            ) else addView(View(ctx), LinearLayout.LayoutParams(MATCH_PARENT, dp(ctx, 24)))
        }
        val maxCol = dp(ctx, if (full) 860 else 700)
        val right = object : android.widget.FrameLayout(ctx) {
            override fun onMeasure(w: Int, h: Int) {
                val lp = column.layoutParams
                lp.width = minOf(MeasureSpec.getSize(w) - edge * 2, maxCol).coerceAtLeast(0)
                super.onMeasure(w, h)
            }
        }.apply {
            addView(column, android.widget.FrameLayout.LayoutParams(maxCol, MATCH_PARENT, Gravity.CENTER_HORIZONTAL))
        }
        root.apply {
            orientation = LinearLayout.HORIZONTAL
            background = ambientBg()
            addView(side, LinearLayout.LayoutParams(sideW, MATCH_PARENT).apply { setMargins(edge, dp(ctx, 36), 0, dp(ctx, 32)) })
            addView(right, LinearLayout.LayoutParams(0, MATCH_PARENT, 1f))
        }
    }

    fun select(page: Int, focus: Boolean) {
        val e = entries.firstOrNull { it.page == page } ?: return
        current = page
        pageMap.forEach { (k, v) -> v.visibility = if (k == page) View.VISIBLE else View.GONE }
        items.forEach { (k, item) -> item.mark(k == page) }
        title.text = e.title
        sub.text = e.subtitle
        if (focus) items[page]?.requestFocus()
    }

    fun setEdited(page: Int, on: Boolean) { items[page]?.setEdited(on) }
    fun focusSidebar() { (items[current] ?: items.values.firstOrNull())?.requestFocus() }
    fun contentHasFocus(f: View?): Boolean {
        var v: View? = f
        while (v != null) { if (v === frame) return true; v = v.parent as? View }
        return false
    }
}

internal class RadioDot(ctx: Context, private val on: Boolean) : View(ctx) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val d = ctx.resources.displayMetrics.density

    override fun onDraw(c: Canvas) {
        val cx = width / 2f
        val cy = height / 2f
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = 2 * d
        paint.color = if (on) C.PRIMARY else C.OUTLINE
        c.drawCircle(cx, cy, 9 * d, paint)
        if (on) {
            paint.style = Paint.Style.FILL
            paint.color = C.PRIMARY
            c.drawCircle(cx, cy, 5 * d, paint)
        }
    }
}

internal fun modalSheet(
    ctx: Context,
    title: String,
    subtitle: String? = null,
    kind: IconView.Kind? = null,
    tint: Int = C.PRIMARY,
    confirmLabel: String? = "Save",
    cancelLabel: String = "Cancel",
    backdrop: () -> View? = { null },
    onConfirm: () -> Unit = {},
    content: (dismiss: () -> Unit) -> View,
): android.app.Dialog {
    val dialog = android.app.Dialog(ctx, android.R.style.Theme_Translucent_NoTitleBar)
    val dm = ctx.resources.displayMetrics
    val tv = isTv(ctx)
    var closing = false

    val card = LinearLayout(ctx).apply {
        orientation = LinearLayout.VERTICAL
        background = GradientDrawable().apply {
            setColor(C.SHEET); cornerRadius = dp(ctx, 30).toFloat()
            setStroke(dp(ctx, 1), Color.argb(40, 255, 255, 255))
        }
        isClickable = true
        isFocusable = false
        if (Build.VERSION.SDK_INT >= 21) elevation = dp(ctx, 16).toFloat()
    }

    fun close(then: (() -> Unit)? = null) {
        if (closing) return
        closing = true
        card.animate().scaleX(0.95f).scaleY(0.95f).alpha(0f).setDuration(120).start()
        card.rootView.animate().alpha(0f).setDuration(140).withEndAction {
            dialog.dismiss(); then?.invoke()
        }.start()
    }

    val header = LinearLayout(ctx).apply {
        gravity = Gravity.CENTER_VERTICAL
        setPadding(dp(ctx, Sp.SHEET), dp(ctx, Sp.SHEET), dp(ctx, Sp.SHEET), dp(ctx, Sp.XL - 4))
        if (kind != null) addView(
            IconView(ctx, kind, tint),
            LinearLayout.LayoutParams(dp(ctx, 44), dp(ctx, 44)).apply { rightMargin = dp(ctx, Sp.L) }
        )
        addView(LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            addView(text(ctx, title, 20f, C.TEXT).apply { typeface = Fonts.bold })
            if (!subtitle.isNullOrBlank()) addView(text(ctx, subtitle, 13f, C.TEXT_DIM), lp(ctx, top = 4))
        }, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f))
    }
    val cardW = minOf(dm.widthPixels - dp(ctx, Sp.XL * 2), dp(ctx, if (tv) 560 else 440))
    card.addView(header, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
    card.addView(divider(ctx), LinearLayout.LayoutParams(MATCH_PARENT, dp(ctx, 1)))

    val body = content { close() }
    body.setPadding(dp(ctx, Sp.SHEET), dp(ctx, Sp.XL - 4), dp(ctx, Sp.SHEET), dp(ctx, Sp.XL - 4))
    val maxH = (dm.heightPixels * (if (tv) 0.6f else 0.56f)).toInt()
    val footer = LinearLayout(ctx)
    card.addView(object : ScrollView(ctx) {
        override fun onMeasure(w: Int, h: Int) {
            val exact = View.MeasureSpec.makeMeasureSpec(cardW, View.MeasureSpec.EXACTLY)
            val free = View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED)
            header.measure(exact, free)
            footer.measure(exact, free)
            val chrome = header.measuredHeight + footer.measuredHeight + dp(ctx, 2) + dp(ctx, 32)
            val cap = minOf(maxH, dm.heightPixels - chrome).coerceAtLeast(dp(ctx, 96))
            super.onMeasure(w, View.MeasureSpec.makeMeasureSpec(cap, View.MeasureSpec.AT_MOST))
        }
    }.apply { isVerticalScrollBarEnabled = false; clipToPadding = false; addView(body) },
        LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))

    card.addView(divider(ctx), LinearLayout.LayoutParams(MATCH_PARENT, dp(ctx, 1)))
    val confirm = confirmLabel?.let { label -> button(ctx, label, filled = true) { onConfirm(); close() } }
    card.addView(footer.apply {
        setPadding(dp(ctx, Sp.SHEET), dp(ctx, Sp.L), dp(ctx, Sp.SHEET), dp(ctx, Sp.SHEET))
        addView(
            button(ctx, cancelLabel, filled = false) { close() },
            LinearLayout.LayoutParams(0, dp(ctx, Sp.BTN_H), 1f).apply { if (confirm != null) rightMargin = dp(ctx, 6) }
        )
        if (confirm != null) addView(
            confirm,
            LinearLayout.LayoutParams(0, dp(ctx, Sp.BTN_H), 1f).apply { leftMargin = dp(ctx, 6) }
        )
    }, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))

    val root = android.widget.FrameLayout(ctx).apply {
        setOnClickListener { close() }
        addView(card, android.widget.FrameLayout.LayoutParams(cardW, WRAP_CONTENT, Gravity.CENTER))
    }

    dialog.setContentView(root)
    dialog.setOnKeyListener { _, code, ev ->
        if ((code == KeyEvent.KEYCODE_BACK || code == KeyEvent.KEYCODE_ESCAPE) && ev.action == KeyEvent.ACTION_UP) {
            close(); true
        } else false
    }
    dialog.window?.apply {
        setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
        setLayout(MATCH_PARENT, MATCH_PARENT)
        adjustResizeCompat()
        applyModalBackdrop(ctx, this, root, backdrop())
    }
    dialog.show()

    root.alpha = 0f
    card.scaleX = 0.94f; card.scaleY = 0.94f; card.translationY = dp(ctx, 12).toFloat()
    root.animate().alpha(1f).setDuration(160).start()
    card.animate().scaleX(1f).scaleY(1f).translationY(0f).setDuration(200)
        .setInterpolator(android.view.animation.DecelerateInterpolator()).start()

    root.post {
        if (root.isInTouchMode) return@post
        val target = card.findViewWithTag<View>("focus-me") ?: run {
            val found = ArrayList<View>()
            body.addFocusables(found, View.FOCUS_DOWN)
            found.firstOrNull() ?: confirm
        }
        target?.requestFocus()
    }
    return dialog
}

internal fun selectRow(ctx: Context, title: String, desc: String, value: TextView, onClick: () -> Unit): View =
    LinearLayout(ctx).apply {
        orientation = LinearLayout.VERTICAL
        minimumHeight = dp(ctx, Sp.ROW_MIN)
        setPadding(dp(ctx, Sp.ROW_H), dp(ctx, Sp.L), dp(ctx, Sp.ROW_H), dp(ctx, Sp.L))
        addView(text(ctx, title, 16f, C.TEXT, bold = true), lp(ctx))
        if (desc.isNotBlank()) addView(text(ctx, desc, 13f, C.TEXT_DIM).apply { setLineSpacing(0f, 1.25f) }, lp(ctx, top = Sp.XS))
        addView(LinearLayout(ctx).apply {
            gravity = Gravity.CENTER_VERTICAL
            background = GradientDrawable().apply { setColor(C.WELL); cornerRadius = dp(ctx, 16).toFloat(); setStroke(dp(ctx, 1), C.HAIRLINE) }
            setPadding(dp(ctx, Sp.L), 0, dp(ctx, Sp.M), 0)
            minimumHeight = dp(ctx, Sp.CTRL_H)
            value.apply {
                textSize = 15f; setTextColor(C.TEXT); typeface = Fonts.medium
                maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.END
            }
            addView(value, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f).apply { rightMargin = dp(ctx, Sp.S) })
            addView(RightChevron(ctx).apply { rotation = 90f }, LinearLayout.LayoutParams(dp(ctx, 20), dp(ctx, 20)))
        }, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { topMargin = dp(ctx, Sp.M) })
        setOnClickListener { onClick() }
        focusRing(ctx, this, 14)
    }

internal fun pickerSheet(
    ctx: Context, title: String, subtitle: String?, labels: List<String>, selected: Int,
    backdrop: () -> View? = { null }, onPick: (Int) -> Unit,
) {
    modalSheet(ctx, title, subtitle, confirmLabel = null, cancelLabel = "Cancel", backdrop = backdrop) { dismiss ->
        LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            labels.forEachIndexed { i, label ->
                val on = i == selected
                addView(LinearLayout(ctx).apply {
                    gravity = Gravity.CENTER_VERTICAL
                    minimumHeight = dp(ctx, 54)
                    setPadding(dp(ctx, 16), 0, dp(ctx, 16), 0)
                    background = GradientDrawable().apply {
                        cornerRadius = dp(ctx, 16).toFloat()
                        if (on) {
                            setColor(Color.argb(38, Color.red(C.PRIMARY), Color.green(C.PRIMARY), Color.blue(C.PRIMARY)))
                            setStroke(dp(ctx, 1), C.PRIMARY)
                        } else {
                            setColor(C.TONAL)
                            setStroke(dp(ctx, 1), C.HAIRLINE)
                        }
                    }
                    addView(text(ctx, label, 16f, C.TEXT, bold = on), LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f))
                    addView(RadioDot(ctx, on), LinearLayout.LayoutParams(dp(ctx, 22), dp(ctx, 22)))
                    if (on) tag = "focus-me"
                    setOnClickListener { onPick(i); dismiss() }
                    focusRing(ctx, this, 16)
                }, lp(ctx, top = if (i == 0) 0 else Sp.S))
            }
        }
    }
}

internal fun providerCard(
    ctx: Context, name: String, description: String?, hasSettings: Boolean, toggle: ToggleView, onSettings: () -> Unit,
): View {
    val info = LinearLayout(ctx).apply {
        orientation = LinearLayout.VERTICAL
        addView(text(ctx, name, 16f, C.TEXT, bold = true))
        val sub = description ?: ""
        if (sub.isNotBlank()) addView(text(ctx, sub, 13f, C.TEXT_DIM), lp(ctx, top = 4))
    }
    return card(ctx).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        minimumHeight = dp(ctx, Sp.ROW_MIN)
        setPadding(dp(ctx, 16), dp(ctx, 14), dp(ctx, 12), dp(ctx, 14))
        addView(info, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f))
        if (hasSettings) addView(GearView(ctx).apply {
            setOnClickListener { onSettings() }
            focusRing(ctx, this, 22, 1.1f)
        }, LinearLayout.LayoutParams(dp(ctx, 48), dp(ctx, 48)).apply { rightMargin = dp(ctx, 2) })
        addView(toggle, LinearLayout.LayoutParams(dp(ctx, 52), dp(ctx, 32)))
        if (toggle.isEnabled) rowFocus(ctx, this, toggle)
    }
}

internal fun EditText.noFullscreenIme() {
    imeOptions = imeOptions or android.view.inputmethod.EditorInfo.IME_FLAG_NO_EXTRACT_UI
}

internal fun editNumber(
    ctx: Context, title: String, hint: String, current: Int, backdrop: () -> View? = { null }, onSet: (Int) -> Unit,
) {
    val et = EditText(ctx).apply {
        typeface = Fonts.regular
        inputType = InputType.TYPE_CLASS_NUMBER
        setText(current.toString()); setSelection(text.length)
        textSize = 20f; setTextColor(C.TEXT); setHintTextColor(C.TEXT_FAINT)
        background = null
        imeOptions = android.view.inputmethod.EditorInfo.IME_ACTION_DONE or
            android.view.inputmethod.EditorInfo.IME_FLAG_NO_EXTRACT_UI
        setPadding(0, dp(ctx, 4), 0, dp(ctx, 4))
    }
    modalSheet(
        ctx, title, backdrop = backdrop,
        onConfirm = { et.text.toString().trim().toIntOrNull()?.let(onSet) }
    ) {
        LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            addView(fieldCard(ctx, et))
            if (hint.isNotBlank()) addView(text(ctx, hint, 13f, C.TEXT_DIM).apply {
                setLineSpacing(0f, 1.25f)
                setPadding(dp(ctx, Sp.S), dp(ctx, Sp.M), dp(ctx, Sp.S), 0)
            })
        }
    }
}
