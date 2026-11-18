package com.eclipsia.core.ui

import android.content.Context
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import com.eclipsia.core.store.PluginStore

internal class SearchTuning(
    private val ctx: Context,
    private val store: PluginStore,
    private val editable: Boolean,
    private val timeoutNote: String,
    private val backdrop: () -> View?,
) {
    var concurrency = store.concurrency
        private set
    var timeout = store.timeoutSeconds
        private set

    val auto = ToggleView(ctx).apply { setChecked(store.concurrencyAuto, false) }

    private val countText = text(ctx, concurrency.toString(), 18f, C.TEXT, bold = true).apply { gravity = Gravity.CENTER }
    private val timeoutText = text(ctx, timeoutLabel(), 18f, C.TEXT, bold = true).apply { gravity = Gravity.CENTER }

    private fun timeoutLabel() = if (timeout == store.TIMEOUT_AUTO) "Auto" else "${timeout}s"

    private fun step(delta: Int) {
        concurrency = (concurrency + delta).coerceIn(1, store.MAX_CONCURRENCY)
        countText.text = concurrency.toString()
    }

    private fun stepTimeout(delta: Int) {
        val next = if (timeout == store.TIMEOUT_AUTO) {
            if (delta > 0) store.MIN_TIMEOUT_SECONDS else store.TIMEOUT_AUTO
        } else timeout + delta
        timeout = if (next < store.MIN_TIMEOUT_SECONDS) store.TIMEOUT_AUTO
        else next.coerceAtMost(store.MAX_TIMEOUT_SECONDS)
        timeoutText.text = timeoutLabel()
    }

    private val concurrencyCard = settingCard(
        ctx, "Concurrency",
        "Providers searched in parallel (1-${store.MAX_CONCURRENCY}). " +
            "Higher is faster but uses more memory. Default: ${store.defaultConcurrency()}",
        stepper(
            ctx, countText, 44,
            { step(-store.CONCURRENCY_STEP) },
            { step(store.CONCURRENCY_STEP) },
            if (editable) {
                {
                    editNumber(ctx, "Concurrency", "1 - ${store.MAX_CONCURRENCY}", concurrency, backdrop) { v ->
                        concurrency = v.coerceIn(1, store.MAX_CONCURRENCY)
                        countText.text = concurrency.toString()
                    }
                }
            } else null
        )
    ).apply {
        visibility = if (auto.checked) View.GONE else View.VISIBLE
    }

    init {
        auto.onChange = { on -> concurrencyCard.visibility = if (on) View.GONE else View.VISIBLE }
    }

    fun addTo(list: LinearLayout) {
        list.addView(sectionLabel(ctx, "Search"))
        val group = list.childCount
        list.addView(
            toggleCard(
                ctx, "Auto concurrency",
                "Enabled: Searches as many providers at once as there are enabled providers",
                auto
            )
        )
        list.addView(concurrencyCard, lp(ctx, top = Sp.GAP))
        list.addView(
            settingCard(
                ctx, "Timeout",
                "Auto gives each provider up to 60s.\nOr, set a limit " +
                    "(${store.MIN_TIMEOUT_SECONDS} - ${store.MAX_TIMEOUT_SECONDS}s) after which the " +
                    timeoutNote,
                stepper(
                    ctx, timeoutText, 56,
                    { stepTimeout(-store.TIMEOUT_STEP_SECONDS) },
                    { stepTimeout(store.TIMEOUT_STEP_SECONDS) },
                    if (editable) {
                        {
                            editNumber(
                                ctx, "Timeout (seconds)",
                                "0 = Auto, otherwise ${store.MIN_TIMEOUT_SECONDS} - ${store.MAX_TIMEOUT_SECONDS}",
                                if (timeout == store.TIMEOUT_AUTO) 0 else timeout,
                                backdrop
                            ) { v ->
                                timeout = if (v < store.MIN_TIMEOUT_SECONDS) store.TIMEOUT_AUTO
                                else v.coerceAtMost(store.MAX_TIMEOUT_SECONDS)
                                timeoutText.text = timeoutLabel()
                            }
                        }
                    } else null
                )
            ),
            lp(ctx, top = Sp.GAP)
        )
        regroup(ctx, list, group)
    }

    fun reset() {
        auto.setChecked(true, false)
        concurrency = store.defaultConcurrency()
        countText.text = concurrency.toString()
        timeout = store.TIMEOUT_AUTO
        timeoutText.text = timeoutLabel()
    }

    fun save() {
        store.concurrency = concurrency
        store.concurrencyAuto = auto.checked
        store.timeoutSeconds = timeout
    }
}
