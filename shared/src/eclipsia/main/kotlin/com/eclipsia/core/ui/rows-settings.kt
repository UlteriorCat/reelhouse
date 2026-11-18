package com.eclipsia.core.ui

import android.content.Context
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.LinearLayout
import com.eclipsia.core.store.ScraperPluginStore

internal class RowsSettings(
    private val ctx: Context,
    private val store: ScraperPluginStore,
    private val list: LinearLayout,
) {
    private val toggles = ArrayList<Pair<String, ToggleView>>()
    private val savers = ArrayList<() -> Unit>()
    private val states = ArrayList<() -> String>()
    private val resetters = ArrayList<() -> Unit>()

    val hiddenCount: Int get() = toggles.count { !it.second.checked }
    val togglesState: String get() = toggles.joinToString { "${it.first}=${it.second.checked}" }
    val orderState: String get() = states.joinToString { it() }

    fun save() {
        toggles.forEach { (title, t) -> store.setCatalogRowEnabled(title, t.checked) }
        savers.forEach { it() }
    }

    fun reset() {
        resetters.forEach { it() }
    }

    fun add(
        group: String, heading: String, subtitle: String, titles: List<String>,
        labels: List<String> = titles, defaultOn: (String) -> Boolean = { true },
    ) {
        val labelOf = titles.zip(labels).toMap()
        val toggleOf = titles.associateWith { k ->
            ToggleView(ctx).apply { setChecked(store.catalogRowEnabled(k, defaultOn(k)), false) }
        }
        toggleOf.forEach { (k, t) -> toggles += k to t }
        val order = store.rowOrder(group, titles).toMutableList()
        savers += { store.setRowOrder(group, order) }
        states += { order.joinToString("|") }
        val rows = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }
        fun render() {
            rows.removeAllViews()
            order.forEachIndexed { idx, key ->
                val t = toggleOf.getValue(key)
                (t.parent as? ViewGroup)?.removeView(t)
                fun move(by: Int) {
                    val to = idx + by
                    if (to !in order.indices) return
                    order.add(to, order.removeAt(idx))
                    render()
                }
                rows.addView(LinearLayout(ctx).apply {
                    orientation = LinearLayout.HORIZONTAL
                    gravity = Gravity.CENTER_VERTICAL
                    setPadding(dp(ctx, 8), dp(ctx, 10), dp(ctx, 8), dp(ctx, 10))
                    addView(text(ctx, labelOf.getValue(key), 16f, C.TEXT), LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f))
                    addView(ChevronButton(ctx, true) { move(-1) }.apply { alpha = if (idx == 0) 0.3f else 1f }, LinearLayout.LayoutParams(dp(ctx, 48), dp(ctx, 48)))
                    addView(ChevronButton(ctx, false) { move(1) }.apply { alpha = if (idx == order.lastIndex) 0.3f else 1f }, LinearLayout.LayoutParams(dp(ctx, 48), dp(ctx, 48)))
                    addView(t, LinearLayout.LayoutParams(dp(ctx, 52), dp(ctx, 32)).apply { leftMargin = dp(ctx, 6) })
                    rowFocus(ctx, this, t, 14)
                }, lp(ctx, top = 0).apply { leftMargin = -dp(ctx, 8); rightMargin = -dp(ctx, 8) })
                if (idx != order.lastIndex) rows.addView(View(ctx).apply { setBackgroundColor(C.HAIRLINE) },
                    LinearLayout.LayoutParams(MATCH_PARENT, dp(ctx, 1)))
            }
        }
        render()
        resetters += {
            order.clear(); order.addAll(titles)
            toggleOf.forEach { (k, t) -> t.setChecked(defaultOn(k), false) }
            render()
        }
        list.addView(card(ctx).apply {
            setPadding(dp(ctx, 16), dp(ctx, 16), dp(ctx, 16), dp(ctx, 16))
            addView(text(ctx, heading, 16f, C.TEXT, bold = true))
            addView(text(ctx, subtitle, 13f, C.TEXT_DIM), lp(ctx, top = 2))
            addView(View(ctx).apply { setBackgroundColor(C.HAIRLINE) },
                LinearLayout.LayoutParams(MATCH_PARENT, dp(ctx, 1)).apply { topMargin = dp(ctx, 12) })
            addView(rows)
        }, lp(ctx, top = Sp.GAP))
    }
}
