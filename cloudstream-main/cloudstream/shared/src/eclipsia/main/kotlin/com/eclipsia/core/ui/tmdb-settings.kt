package com.eclipsia.core.ui

import android.content.Context
import android.text.InputType
import android.view.View
import android.widget.EditText
import android.widget.LinearLayout
import com.eclipsia.core.store.ScraperPluginStore

internal class TmdbSettings(
    ctx: Context,
    store: ScraperPluginStore,
    initialRegion: String?,
    list: LinearLayout,
) {
    val key: EditText
    val personal: ToggleView
    private val regionField: EditText?
    private val languageField: EditText

    val keyText: String get() = key.text.toString()
    val region: String get() = regionField?.text?.toString().orEmpty()
    val language: String get() = languageField.text.toString()

    init {
        fun field(initial: String, hintText: String) = EditText(ctx).apply {
            typeface = Fonts.regular
            noFullscreenIme()
            hint = hintText
            setText(initial)
            textSize = 16f
            setTextColor(C.TEXT)
            setHintTextColor(C.TEXT_FAINT)
            inputType = InputType.TYPE_CLASS_TEXT
            background = null
            setPadding(0, dp(ctx, 4), 0, dp(ctx, 4))
        }
        fun note(msg: String) = text(ctx, msg, 13f, C.TEXT_DIM).apply {
            setPadding(dp(ctx, 8), dp(ctx, 10), dp(ctx, 8), dp(ctx, 6))
        }

        key = field(store.tmdbKeyOverride, "Enter your TMDb API key")
        val keyCard = fieldCard(ctx, key)
        val keyHint =
            text(ctx, "Used instead of the built-in key [Recommended]", 13f, C.TEXT_DIM).apply {
                setPadding(dp(ctx, 8), dp(ctx, 10), dp(ctx, 8), 0)
            }
        personal = ToggleView(ctx).apply {
            setChecked(store.tmdbPersonalEnabled, false)
            onChange = { on ->
                val v = if (on) View.VISIBLE else View.GONE
                keyCard.visibility = v; keyHint.visibility = v
            }
        }
        keyCard.visibility = if (personal.checked) View.VISIBLE else View.GONE
        keyHint.visibility = keyCard.visibility
        list.addView(
            toggleCard(ctx, "Personal API key", "Custom API key is Recommended\nDisabled: built-in key is used", personal)
        )
        list.addView(keyCard, lp(ctx, top = Sp.GAP))
        list.addView(keyHint)

        list.addView(sectionLabel(ctx, if (initialRegion != null) "Region & language" else "Language"))
        if (initialRegion != null) {
            regionField = field(initialRegion, "US")
            list.addView(fieldCard(ctx, regionField), lp(ctx, top = Sp.GAP))
            list.addView(note("Country code (e.g. US, GB, DE), used for the home rows."))
        } else {
            regionField = null
        }
        languageField = field(store.language, "en-US")
        list.addView(fieldCard(ctx, languageField), lp(ctx, top = Sp.GAP))
        list.addView(note("TMDb language for titles, descriptions and title logos (e.g. en-US, de-DE, pt-BR). Invalid values fall back to ${store.DEFAULT_LANGUAGE}."))
    }
}
