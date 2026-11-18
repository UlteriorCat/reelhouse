package com.eclipsia.core.ui

import android.content.Context
import android.text.InputType
import android.view.View
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.EditText
import android.widget.LinearLayout
import com.eclipsia.core.catalog.EclipsiaTmdb
import com.eclipsia.core.store.ScraperPluginStore
import kotlinx.coroutines.CoroutineScope

internal class PosterSettings(
    ctx: Context,
    store: ScraperPluginStore,
    scope: CoroutineScope,
    caption: String,
    list: LinearLayout,
) {
    val urlField: EditText
    val toggle: ToggleView
    val hideLabels: ToggleView

    val template: String get() = urlField.text.toString()

    init {
        urlField = EditText(ctx).apply {
            typeface = Fonts.regular
            noFullscreenIme()
            hint = "https://…/{imdb_id}.jpg"
            setText(store.customPosterTemplate)
            textSize = 14f
            setTextColor(C.TEXT)
            setHintTextColor(C.TEXT_FAINT)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            background = null
            setPadding(0, dp(ctx, 4), 0, dp(ctx, 4))
        }
        val fieldCardView = fieldCard(ctx, urlField)
        val posterHint = text(
            ctx,
                "Default poster is used when poster is missing. Applies to the home page, details and recommendations.",
            13f, C.TEXT_DIM
        ).apply { setPadding(dp(ctx, 8), dp(ctx, 10), dp(ctx, 8), dp(ctx, 6)) }
        val posterPresets = listOf(
            "BetterPosters" to "https://btttr.cc/poster-ra/imdb/poster-default/{imdb_id}.jpg?tag=none&rs=IM",
            "Poster+" to "https://postersplus.elfhosted.com/p/bar_sash/{type}/{imdb_id}.jpg",
        )
        val posterChips = LinearLayout(ctx).apply {
            posterPresets.forEach { (label, url) ->
                addView(chip(ctx, label) { urlField.setText(url) }, LinearLayout.LayoutParams(WRAP_CONTENT, dp(ctx, 36)).apply { rightMargin = dp(ctx, 8) })
            }
        }
        toggle = ToggleView(ctx).apply {
            setChecked(store.customPosterEnabled, false)
            onChange = { on ->
                val v = if (on) View.VISIBLE else View.GONE
                fieldCardView.visibility = v; posterHint.visibility = v; posterChips.visibility = v
            }
        }
        val posterVisibility = if (toggle.checked) View.VISIBLE else View.GONE
        fieldCardView.visibility = posterVisibility
        posterHint.visibility = posterVisibility
        posterChips.visibility = posterVisibility
        list.addView(toggleCard(ctx, "Custom Poster", "Disabled: Default posters are used", toggle))
        list.addView(fieldCardView, lp(ctx, top = Sp.GAP))
        list.addView(posterHint)
        list.addView(posterChips, lp(ctx, top = Sp.M))

        hideLabels = ToggleView(ctx).apply { setChecked(store.hideLabels, false) }
        list.addView(
            toggleCard(ctx, "Hide Labels", "Enabled: no label below posters on home rows and recommendations", hideLabels),
            lp(ctx, top = Sp.GAP)
        )

        val (posterPreview, reloadPosterPreview) = PosterPreview.build(ctx, scope, caption, { hideLabels.checked }, { store.language }, { EclipsiaTmdb.get(it) }) {
            if (!toggle.checked) null
            else urlField.text.toString().trim()
                .replace("%7B", "{", ignoreCase = true).replace("%7D", "}", ignoreCase = true)
                .takeIf { it.startsWith("https://", ignoreCase = true) }
        }
        posterPreview.tag = "nofp"
        list.addView(posterPreview, lp(ctx, top = 16))
        hideLabels.onChange = { reloadPosterPreview() }
        val toggleVisibility = toggle.onChange
        toggle.onChange = { on ->
            toggleVisibility?.invoke(on)
            reloadPosterPreview()
        }
        posterPresets.forEachIndexed { i, preset ->
            posterChips.getChildAt(i).setOnClickListener { urlField.setText(preset.second); reloadPosterPreview() }
        }
        reloadPosterPreview()
    }
}
