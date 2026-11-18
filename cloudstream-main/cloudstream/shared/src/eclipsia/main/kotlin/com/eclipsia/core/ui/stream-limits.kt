package com.eclipsia.core.ui

import android.content.Context
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import com.eclipsia.core.store.ScraperPluginStore

internal class StreamLimits(
    private val ctx: Context,
    private val store: ScraperPluginStore,
    private val providers: List<Pair<String, String>>,
    private val backdrop: () -> View?,
) {
    var total = store.totalCap
        private set

    val perProvider = ToggleView(ctx).apply { setChecked(store.perProviderCapEnabled, false) }
    val providerCaps = HashMap<String, Int>()

    private val totalText = text(ctx, capLabel(total), 18f, C.TEXT, bold = true).apply { gravity = Gravity.CENTER }
    private val perBox = LinearLayout(ctx).apply {
        orientation = LinearLayout.VERTICAL
        visibility = if (perProvider.checked) View.VISIBLE else View.GONE
    }
    private val refreshers = ArrayList<() -> Unit>()

    private fun capLabel(v: Int) = if (v <= 0) "Off" else v.toString()

    init {
        providers.forEach { (id, name) ->
            var v = store.providerCap(id)
            providerCaps[id] = v
            val t = text(ctx, capLabel(v), 18f, C.TEXT, bold = true).apply { gravity = Gravity.CENTER }
            perBox.addView(
                settingCard(
                    ctx, name, "Maximum streams from this provider. Off = no limit",
                    stepper(
                        ctx, t, 44,
                        { v = (v - 1).coerceAtLeast(0); providerCaps[id] = v; t.text = capLabel(v) },
                        { v = (v + 1).coerceAtMost(store.MAX_STREAM_CAP); providerCaps[id] = v; t.text = capLabel(v) }
                    )
                ),
                lp(ctx, top = Sp.GAP)
            )
            refreshers += { v = 0; providerCaps[id] = 0; t.text = capLabel(0) }
        }
        perProvider.onChange = { on -> perBox.visibility = if (on) View.VISIBLE else View.GONE }
    }

    fun addTo(list: LinearLayout) {
        list.addView(sectionLabel(ctx, "Stream limit"))
        val group = list.childCount
        list.addView(
            settingCard(
                ctx, "Total streams",
                "Maximum number of streams kept across all providers. Off = no limit",
                stepper(
                    ctx, totalText, 44,
                    { total = (total - 1).coerceAtLeast(0); totalText.text = capLabel(total) },
                    { total = (total + 1).coerceAtMost(store.MAX_STREAM_CAP); totalText.text = capLabel(total) },
                    {
                        editNumber(ctx, "Total streams", "0 = Off (no limit), max ${store.MAX_STREAM_CAP}", total, backdrop) { v ->
                            total = v.coerceIn(0, store.MAX_STREAM_CAP)
                            totalText.text = capLabel(total)
                        }
                    }
                )
            )
        )
        list.addView(
            toggleCard(ctx, "Limit per provider", "Enabled: set a maximum number of streams for each provider", perProvider),
            lp(ctx, top = Sp.GAP)
        )
        regroup(ctx, list, group)
        list.addView(perBox)
    }

    fun reset() {
        total = 0
        totalText.text = capLabel(0)
        perProvider.setChecked(false, false)
        refreshers.forEach { it() }
    }

    fun save() {
        store.totalCap = total
        store.perProviderCapEnabled = perProvider.checked
        providerCaps.forEach { (id, v) -> store.setProviderCap(id, v) }
    }
}
