package com.eclipsiabdix

import com.eclipsia.core.ui.Fonts
import com.eclipsia.core.ui.*

import android.content.Context
import android.text.InputType
import android.widget.TextView
import com.eclipsia.core.AppRestart
import android.view.Gravity
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.view.WindowManager
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView

object EclipsiaSettingsUi {
    fun show(ctx: Context) {
        val dialog = SettingsDialog(ctx)
        var backdropRef: java.lang.ref.WeakReference<View>? = null
        val modalBackdrop: () -> View? = { backdropRef?.get() }
        val scrapers = EclipsiaRepository.allScrapers()
        val toggles = ArrayList<Pair<EclipsiaScraper, ToggleView>>()

        val wide = isWideLayout(ctx)
        fun pageColumn() = settingsPageColumn(ctx, wide)
        val perfList = pageColumn()
        val posterList = pageColumn()
        val menuList = pageColumn()
        val provList = pageColumn()
        var showPage: (Int) -> Unit = {}

        val subtitle = text(ctx, "", 14f, C.TEXT_DIM)
        fun refreshSubtitle() {
            subtitle.text = "${toggles.count { it.second.checked }} of ${scrapers.size} providers enabled"
        }

        val dirtyChip = text(ctx, "●  Unsaved changes", 13f, WARN, bold = true).apply { visibility = View.GONE }
        val header = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            if (!wide) background = headerScrim(ctx)
            setPadding(dp(ctx, 24), vGap(ctx, 0.015f, 8, 20), dp(ctx, 24), dp(ctx, 20))
            if (!wide) {
                addView(brandText(ctx, "EclipsiaBDIX", 32f))
                addView(subtitle, lp(ctx, top = 6))
            }
        }

        val perf = SearchTuning(
            ctx, EclipsiaStore, false,
            "whole search stops. Links already found are kept.",
            modalBackdrop
        )
        perf.addTo(perfList)
        perfList.addView(button(ctx, "Reset search settings", filled = false) {
            perf.reset()
            toast(ctx, "Search settings reset. Press Save to apply")
        }, LinearLayout.LayoutParams(MATCH_PARENT, dp(ctx, Sp.BTN_H)).apply { topMargin = dp(ctx, 32) })

        val posterField = EditText(ctx).apply {
            typeface = Fonts.regular
            noFullscreenIme()
            hint = "https://…/{imdb_id}.jpg"
            setText(EclipsiaStore.customPosterTemplate)
            textSize = 14f
            setTextColor(C.TEXT)
            setHintTextColor(C.TEXT_FAINT)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            background = null
            setPadding(0, dp(ctx, 4), 0, dp(ctx, 4))
        }
        val posterFieldCard = fieldCard(ctx, posterField)
        val posterHint = text(
            ctx,
            "Placeholders: {imdb_id} and {type}. The default poster is used when this is disabled. " +
                "Applies to the home page, search and details.",
            13f, C.TEXT_DIM
        ).apply { setPadding(dp(ctx, 8), dp(ctx, 10), dp(ctx, 8), dp(ctx, 6)) }
        val posterPresets = listOf(
            "BetterPosters" to "https://btttr.cc/poster-ra/imdb/poster-default/{imdb_id}.jpg?tag=none&rs=IM",
            "Poster+" to "https://postersplus.elfhosted.com/p/bar_sash/{type}/{imdb_id}.jpg",
        )
        val posterChips = LinearLayout(ctx).apply {
            posterPresets.forEach { (label, url) ->
                addView(chip(ctx, label) { posterField.setText(url) },
                    LinearLayout.LayoutParams(WRAP_CONTENT, dp(ctx, 36)).apply { rightMargin = dp(ctx, 8) })
            }
        }
        val posterToggle = ToggleView(ctx).apply {
            setChecked(EclipsiaStore.customPosterEnabled, false)
            onChange = { on ->
                val v = if (on) View.VISIBLE else View.GONE
                posterFieldCard.visibility = v; posterHint.visibility = v; posterChips.visibility = v
            }
        }
        val posterVisibility = if (posterToggle.checked) View.VISIBLE else View.GONE
        posterFieldCard.visibility = posterVisibility
        posterHint.visibility = posterVisibility
        posterChips.visibility = posterVisibility
        posterList.addView(toggleCard(ctx, "Custom Poster", "Disabled: default posters are used", posterToggle))
        posterList.addView(posterFieldCard, lp(ctx, top = Sp.GAP))
        posterList.addView(posterHint)
        posterList.addView(posterChips, lp(ctx, top = Sp.M))

        var query = ""
        var applyFilter: () -> Unit = {}
        val providerViews = ArrayList<Pair<EclipsiaScraper, View>>()
        var enableAllBtn: TextView? = null
        var disableAllBtn: TextView? = null
        fun matches(sc: EclipsiaScraper) = query.isEmpty() ||
            sc.name.contains(query, ignoreCase = true) || sc.description.orEmpty().contains(query, ignoreCase = true)
        provList.addView(sectionLabel(ctx, "Providers"))
        fun setAll(on: Boolean) {
            toggles.forEach { (sc, t) -> if (matches(sc)) t.setChecked(on, false) }
        }
        provList.addView(LinearLayout(ctx).apply {
            addView(
                button(ctx, "Enable all", filled = true) { setAll(true) }.also { enableAllBtn = it },
                LinearLayout.LayoutParams(0, dp(ctx, 44), 1f).apply { rightMargin = dp(ctx, 6) })
            addView(
                button(ctx, "Disable all", filled = false) { setAll(false) }.also { disableAllBtn = it },
                LinearLayout.LayoutParams(0, dp(ctx, 44), 1f).apply { leftMargin = dp(ctx, 6) })
        })
        val plainRows = ArrayList<View>()
        if (scrapers.isEmpty()) provList.addView(text(ctx, "No providers bundled.", 15f, C.TEXT_DIM))
        scrapers.forEach { sc ->
            val toggle = ToggleView(ctx).apply {
                setChecked(EclipsiaStore.isEnabled(sc.id, sc.defaultEnabled), false)
                onChange = { refreshSubtitle() }
            }
            toggles += sc to toggle
            val card = toggleCard(ctx, sc.name, sc.description.orEmpty(), toggle)
            providerViews += sc to card
            plainRows += card
        }
        if (plainRows.isNotEmpty()) provList.addView(group(ctx, plainRows), lp(ctx, top = Sp.GAP))
        provList.addView(
            text(ctx, "BDIX-connected networks only", 13f, C.TEXT_DIM).apply {
                setLineSpacing(0f, 1.25f); setPadding(dp(ctx, 8), dp(ctx, 12), dp(ctx, 8), 0)
            }
        )
        applyFilter = {
            providerViews.forEach { (sc, v) -> v.visibility = if (matches(sc)) View.VISIBLE else View.GONE }
            enableAllBtn?.text = if (query.isEmpty()) "Enable all" else "Enable shown"
            disableAllBtn?.text = if (query.isEmpty()) "Disable all" else "Disable shown"
        }
        refreshSubtitle()

        fun stateSnapshot(): String = listOf<Any?>(
            perf.concurrency,
            perf.auto.checked,
            perf.timeout,
            posterField.text.toString(),
            posterToggle.checked,
            toggles.joinToString { "${it.first.id}=${it.second.checked}" },
        ).joinToString("\u0001")
        val initialState = stateSnapshot()

        fun saveAll() {
            perf.save()
            val posterChanged = posterToggle.checked != EclipsiaStore.customPosterEnabled
            EclipsiaStore.customPosterTemplate = posterField.text.toString()
            EclipsiaStore.customPosterEnabled = posterToggle.checked
            toggles.forEach { (sc, t) -> EclipsiaStore.setEnabled(sc.id, t.checked) }
            toast(ctx, if (posterChanged) "Saved. Restarting to apply poster changes" else "Saved")
            dialog.dismiss()
            if (posterChanged) AppRestart.restart(ctx) { EclipsiaStore.flush() }
        }

        fun isDirty() = stateSnapshot() != initialState

        fun requestSave() = saveAll()

        fun confirmExit() {
            unsavedChangesDialog(
                ctx,
                backdrop = dialog.window?.decorView ?: return,
                onSave = { requestSave() },
                onDiscard = { dialog.dismiss() },
            )
        }

        val cancelBtn = button(ctx, "Close", filled = false) {
            if (isDirty()) confirmExit() else dialog.dismiss()
        }
        val saveBtn = button(ctx, "Save", filled = true) { requestSave() }
        fun refreshDirty() {
            val d = isDirty()
            cancelBtn.text = if (d) "Cancel" else "Close"
            saveBtn.isEnabled = d
            if (!d && saveBtn.hasFocus()) cancelBtn.requestFocus()
            saveBtn.isFocusable = d
            saveBtn.alpha = if (d) 1f else 0.4f
        }

        val buttonsRow = LinearLayout(ctx).apply {
            background = glassPanel(ctx, 30)
            setPadding(dp(ctx, 6), dp(ctx, 6), dp(ctx, 6), dp(ctx, 6))
            if (!wide) addView(cancelBtn, LinearLayout.LayoutParams(0, dp(ctx, 52), 1f).apply { rightMargin = dp(ctx, 4) })
            if (!wide) addView(saveBtn, LinearLayout.LayoutParams(0, dp(ctx, 52), 1f).apply { leftMargin = dp(ctx, 4) })
        }
        val actions = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(ctx, Sp.PAGE), dp(ctx, Sp.S), dp(ctx, Sp.PAGE), vGap(ctx, 0.015f, 8, 20))
            addView(buttonsRow, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
        }

        val menuCards = HashMap<Int, View>()
        var pageViewsRef: List<View> = emptyList()
        val initFps = HashMap<Int, String>()
        fun isEdited(i: Int): Boolean {
            val v = pageViewsRef.getOrNull(i) ?: return false
            val init = initFps[i] ?: return false
            return init != fingerprint(v)
        }
        val perfSub = text(ctx, "", 13f, C.TEXT_DIM)
        val posterSub = text(ctx, "", 13f, C.TEXT_DIM)
        fun refreshMenu() {
            val atOnce = if (perf.auto.checked) "${toggles.count { it.second.checked }.coerceAtLeast(1)} at once (Auto)"
            else "${perf.concurrency} at once"
            perfSub.text = editedText(
                "$atOnce \u2022 " + (if (perf.timeout == EclipsiaStore.TIMEOUT_AUTO) "Auto timeout" else "${perf.timeout}s timeout"),
                isEdited(2)
            )
            posterSub.text = editedText(if (posterToggle.checked) "Custom poster" else "Default posters", isEdited(3))
        }
        refreshMenu()
        menuList.addView(supportCard(ctx), lp(ctx, top = Sp.XS))
        menuList.addView(sectionLabel(ctx, "Search"))
        menuList.addView(
            menuCard(ctx, IconView.Kind.BOLT, C.ICON, "Performance", perfSub) { showPage(2) }.also { menuCards[2] = it },
            lp(ctx, top = 0)
        )
        menuList.addView(sectionLabel(ctx, "Content"))
        menuList.addView(
            menuCard(ctx, IconView.Kind.IMAGE, C.ICON, "Poster", posterSub) { showPage(3) }.also { menuCards[3] = it },
            lp(ctx, top = 0)
        )

        val provScroll = ScrollView(ctx).apply { isVerticalScrollBarEnabled = false; addView(provList) }
        val menuScroll = ScrollView(ctx).apply { isVerticalScrollBarEnabled = false; addView(menuList) }
        val perfPage = subPage(ctx, "Performance", "Search speed and timeout", perfList) { showPage(1) }
        val posterPage = subPage(ctx, "Poster", "Custom poster", posterList) { showPage(1) }
        val pageViews = listOf<View>(provScroll, menuScroll, perfPage, posterPage)
        pageViewsRef = pageViews
        val shell: WideShell? = if (!wide) null else WideShell(
            ctx, "EclipsiaBDIX", subtitle, dirtyChip,
            listOf(
                NavEntry(0, IconView.Kind.PLUG, "Providers", "Providers", "Choose which sources are searched"),
                NavEntry(2, IconView.Kind.BOLT, "Performance", "Performance", "Search speed and timeout"),
                NavEntry(3, IconView.Kind.IMAGE, "Posters", "Posters", "Custom poster"),
            ),
            mapOf<Int, View>(0 to provScroll, 2 to perfPage, 3 to posterPage),
            cancelBtn, saveBtn,
            { openDonate(ctx) },
        )
        val pages = android.widget.FrameLayout(ctx).apply {
            if (!wide) pageViews.forEach { addView(it, MATCH_PARENT, MATCH_PARENT) }
        }
        var current = 0
        val tabs = SegmentedTabs(ctx, listOf("Providers", "Settings")) { showPage(it) }
        showPage = { i ->
            if (shell != null) {
                current = i
                shell.select(i, focus = false)
            } else {
                val prev = current
                current = i
                pageViews.forEachIndexed { idx, v -> v.visibility = if (idx == i) View.VISIBLE else View.GONE }
                val top = i <= 1
                header.visibility = if (top) View.VISIBLE else View.GONE
                tabs.visibility = if (top) View.VISIBLE else View.GONE
                tabs.select(i)
                if (i == 1) refreshMenu()
                if (!pages.isInTouchMode) {
                    val target: View = if (i == 1 && prev >= 2) (menuCards[prev] ?: menuList) else pageViews[i]
                    target.requestFocus()
                }
            }
        }
        showPage(0)
        dialog.handleBack = {
            when {
                shell != null && dialog.currentFocus != null && shell.contentHasFocus(dialog.currentFocus) -> shell.focusSidebar()
                !wide && current >= 2 -> showPage(1)
                isDirty() -> confirmExit()
                else -> dialog.dismiss()
            }
        }

        val root: View = shell?.root ?: LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            background = ambientBg()
            val maxW = minOf(ctx.resources.displayMetrics.widthPixels, dp(ctx, 640))
            fun colLp(h: Int, w: Float = 0f) =
                (if (w > 0f) LinearLayout.LayoutParams(maxW, h, w) else LinearLayout.LayoutParams(maxW, h))
                    .apply { gravity = Gravity.CENTER_HORIZONTAL }
            header.addView(tabs, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { topMargin = dp(ctx, Sp.L) })
            underHeader(header, provScroll, menuScroll)
            aboveDock(actions, pageViews)
            addView(android.widget.FrameLayout(ctx).apply {
                addView(pages, android.widget.FrameLayout.LayoutParams(maxW, MATCH_PARENT, Gravity.CENTER_HORIZONTAL))
                addView(header, android.widget.FrameLayout.LayoutParams(maxW, WRAP_CONTENT, Gravity.TOP or Gravity.CENTER_HORIZONTAL))

                addView(actions, android.widget.FrameLayout.LayoutParams(maxW, WRAP_CONTENT, Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL))
            }, colLp(0, 1f))
        }
        dialog.setContentView(root)
        backdropRef = java.lang.ref.WeakReference(root)
        dialog.window?.apply {
            setBackgroundDrawable(ambientBg())
            addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS)
            setSystemBarColors(C.BG)
        }

        dialog.onMenuKey = { (if (saveBtn.isEnabled) saveBtn else cancelBtn).requestFocus() }

        (2 until pageViews.size).forEach { initFps[it] = fingerprint(pageViews[it]) }
        refreshMenu()
        dialog.show()
        dialog.rebuildOnLayoutChange(ctx) { show(ctx) }

        val ui = android.os.Handler(android.os.Looper.getMainLooper())
        val watcher = object : Runnable {
            override fun run() {
                if (!dialog.isShowing) return
                refreshDirty()
                if (current == 1) refreshMenu()
                if (shell != null) (2 until pageViews.size).forEach { shell.setEdited(it, isEdited(it)) }
                ui.postDelayed(this, if (isTv(ctx)) 400L else 250L)
            }
        }
        ui.post(watcher)

        root.post { if (!root.isInTouchMode) { if (shell != null) shell.focusSidebar() else pageViews[current].requestFocus() } }
    }
}
