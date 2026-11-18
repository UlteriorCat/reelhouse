package com.playz

import android.content.Context
import android.view.Gravity
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import com.playz.core.AppRestart
import com.playz.core.ui.*

object PlayzSettingsUi {

    private class RowsEditor(
        private val ctx: Context,
        defaults: List<String>,
        parent: LinearLayout,
        private val onChange: () -> Unit,
        top: Int = Sp.GAP,
    ) {
        val order = PlayzSettings.rowOrder(defaults).toMutableList()
        val hidden = defaults.filter { !PlayzSettings.rowEnabled(it) }.toMutableSet()
        private val toggles = HashMap<String, ToggleView>()
        private val rows = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }

        init {
            order.forEach { key ->
                val t = ToggleView(ctx).apply { setChecked(key !in hidden, false) }
                t.onChange = { on ->
                    if (on) hidden.remove(key) else hidden.add(key)
                    onChange()
                }
                toggles[key] = t
            }
            render()
            parent.addView(card(ctx).apply {
                setPadding(dp(ctx, 16), dp(ctx, 16), dp(ctx, 16), dp(ctx, 16))
                addView(text(ctx, "LiveSports", 16f, C.TEXT, bold = true))
                addView(text(ctx, "Rows on the home page. Use the arrows to reorder. Live Now stays first", 13f, C.TEXT_DIM), lp(ctx, top = 2))
                addView(divider(ctx), LinearLayout.LayoutParams(MATCH_PARENT, dp(ctx, 1)).apply { topMargin = dp(ctx, 12) })
                addView(rows)
            }, lp(ctx, top = top))
        }

        val hiddenCount: Int get() = hidden.size

        val state: String get() = order.joinToString("|") + "#" + hidden.sorted().joinToString("|")

        fun showAll() {
            hidden.clear()
            toggles.values.forEach { it.setChecked(true, false) }
        }

        fun resetOrder(defaults: List<String>) {
            order.clear()
            order.addAll(PlayzSettings.pinFirst(defaults))
            render()
        }

        private fun render() {
            rows.removeAllViews()
            order.forEachIndexed { idx, key ->
                val t = toggles.getValue(key)
                (t.parent as? android.view.ViewGroup)?.removeView(t)
                val pinned = key == PlayzSettings.PINNED_ROW
                fun move(by: Int) {
                    val to = idx + by
                    if (pinned || to !in order.indices || order[to] == PlayzSettings.PINNED_ROW) return
                    order.add(to, order.removeAt(idx))
                    render()
                    onChange()
                }
                val canUp = !pinned && idx > 0 && order[idx - 1] != PlayzSettings.PINNED_ROW
                val canDown = !pinned && idx < order.lastIndex
                rows.addView(LinearLayout(ctx).apply {
                    orientation = LinearLayout.HORIZONTAL
                    gravity = Gravity.CENTER_VERTICAL
                    setPadding(dp(ctx, 8), dp(ctx, 10), dp(ctx, 8), dp(ctx, 10))
                    addView(text(ctx, key, 16f, C.TEXT), LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f))
                    addView(ChevronButton(ctx, true) { move(-1) }.apply { alpha = if (canUp) 1f else 0.3f }, LinearLayout.LayoutParams(dp(ctx, 48), dp(ctx, 48)))
                    addView(ChevronButton(ctx, false) { move(1) }.apply { alpha = if (canDown) 1f else 0.3f }, LinearLayout.LayoutParams(dp(ctx, 48), dp(ctx, 48)))
                    addView(t, LinearLayout.LayoutParams(dp(ctx, 52), dp(ctx, 32)).apply { leftMargin = dp(ctx, 6) })
                    rowFocus(ctx, this, t, 14)
                }, lp(ctx, top = 0).apply { leftMargin = -dp(ctx, 8); rightMargin = -dp(ctx, 8) })
                if (idx != order.lastIndex) rows.addView(divider(ctx), LinearLayout.LayoutParams(MATCH_PARENT, dp(ctx, 1)))
            }
        }
    }

    fun show(ctx: Context) {
        val dialog = SettingsDialog(ctx)
        val wide = isWideLayout(ctx)

        val horizontalToggle = ToggleView(ctx).apply { setChecked(PlayzSettings.horizontalPosters, false) }
        var editor: RowsEditor? = null
        val seen = PlayzSettings.seenRows()

        val dirtyChip = text(ctx, "●  Unsaved changes", 13f, WARN, bold = true).apply { visibility = View.GONE }
        val subtitle = text(ctx, "LiveSports", 14f, C.TEXT_DIM)

        fun state() = listOf(
            horizontalToggle.checked.toString(),
            editor?.state ?: "",
        ).joinToString("/")

        var baseline = ""
        fun isDirty() = state() != baseline

        fun pageColumn() = settingsPageColumn(ctx, wide)
        val menuList = pageColumn()
        val homeList = pageColumn()
        val posterList = pageColumn()
        var showPage: (Int) -> Unit = {}

        fun note(msg: String) = text(ctx, msg, 13f, C.TEXT_DIM).apply {
            setLineSpacing(0f, 1.25f)
            setPadding(dp(ctx, 8), dp(ctx, 10), dp(ctx, 8), dp(ctx, 6))
        }

        fun resetButton(onClick: () -> Unit) = button(ctx, "Reset to defaults", filled = false) { onClick() }

        posterList.addView(sectionLabel(ctx, "Posters", first = true))
        posterList.addView(
            toggleCard(ctx, "Horizontal posters", "Show landscape posters on the home page. Applies after restart", horizontalToggle),
            lp(ctx, top = 0)
        )
        posterList.addView(resetButton {
            horizontalToggle.setChecked(false, false)
            toast(ctx, "Posters reset. Press Save to apply")
        }, LinearLayout.LayoutParams(MATCH_PARENT, dp(ctx, Sp.BTN_H)).apply { topMargin = dp(ctx, 32) })

        homeList.addView(sectionLabel(ctx, "Rows", first = true))
        if (seen.isNotEmpty()) {
            editor = RowsEditor(ctx, seen, homeList, {}, top = 0)
            homeList.addView(note("Hiding or reordering rows applies after restart."), lp(ctx, top = 0))
            homeList.addView(resetButton {
                editor?.let {
                    it.showAll()
                    it.resetOrder(seen)
                }
                toast(ctx, "Home rows reset. Press Save to apply")
            }, LinearLayout.LayoutParams(MATCH_PARENT, dp(ctx, Sp.BTN_H)).apply { topMargin = dp(ctx, 32) })
        } else {
            homeList.addView(note("Rows show up here after the home page has loaded once."), lp(ctx, top = 0))
        }

        baseline = state()

        val menuCards = HashMap<Int, View>()
        var pageViewsRef: List<View> = emptyList()
        val initFps = HashMap<Int, String>()
        fun isEdited(i: Int): Boolean {
            val v = pageViewsRef.getOrNull(i) ?: return false
            val init = initFps[i] ?: return false
            return init != fingerprint(v)
        }
        val homeSub = text(ctx, "", 13f, C.TEXT_DIM)
        val posterSub = text(ctx, "", 13f, C.TEXT_DIM)
        fun refreshMenu() {
            val hidden = editor?.hiddenCount ?: 0
            homeSub.text = editedText(
                when {
                    editor == null -> "Available after the first load"
                    hidden == 0 -> "All rows shown"
                    else -> "$hidden rows hidden"
                },
                isEdited(1)
            )
            posterSub.text = editedText(
                if (horizontalToggle.checked) "Horizontal posters" else "Vertical posters",
                isEdited(2)
            )
        }
        refreshMenu()
        menuList.addView(supportCard(ctx), lp(ctx, top = Sp.XS))
        menuList.addView(sectionLabel(ctx, "Content"))
        val gContent = menuList.childCount
        menuList.addView(
            menuCard(ctx, IconView.Kind.LIST, C.ICON, "Home", homeSub) { showPage(1) }.also { menuCards[1] = it },
            lp(ctx, top = 0)
        )
        menuList.addView(
            menuCard(ctx, IconView.Kind.IMAGE, C.ICON, "Poster", posterSub) { showPage(2) }.also { menuCards[2] = it },
            lp(ctx, top = Sp.GAP)
        )
        regroup(ctx, menuList, gContent)

        fun persist() {
            PlayzSettings.horizontalPosters = horizontalToggle.checked
            editor?.let { e ->
                PlayzSettings.setRowOrder(e.order)
                e.order.forEach { PlayzSettings.setRowEnabled(it, it !in e.hidden) }
            }
        }

        fun requestSave() {
            if (!isDirty()) {
                dialog.dismiss()
                return
            }
            persist()
            toast(ctx, "Saved. Restarting…")
            AppRestart.restart(ctx) { PlayzSettings.flush() }
        }

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
            dirtyChip.visibility = if (d) View.VISIBLE else View.GONE
        }

        val header = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            if (!wide) background = headerScrim(ctx)
            setPadding(dp(ctx, 24), vGap(ctx, 0.015f, 8, 20), dp(ctx, 24), dp(ctx, 20))
            if (!wide) {
                addView(brandText(ctx, "Playz", 32f))
                addView(subtitle, lp(ctx, top = 6))
            }
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

        val menuScroll = ScrollView(ctx).apply { isVerticalScrollBarEnabled = false; addView(menuList) }
        val homePage = subPage(ctx, "Home", "Show, hide and reorder rows", homeList) { showPage(0) }
        val posterPage = subPage(ctx, "Poster", "Poster orientation on the home page", posterList) { showPage(0) }
        val pageViews = listOf<View>(menuScroll, homePage, posterPage)
        pageViewsRef = pageViews

        val shell: WideShell? = if (!wide) null else WideShell(
            ctx, "Playz", subtitle, dirtyChip,
            listOf(
                NavEntry(1, IconView.Kind.LIST, "Home rows", "Home rows", "Show, hide and reorder rows"),
                NavEntry(2, IconView.Kind.IMAGE, "Posters", "Posters", "Poster orientation on the home page"),
            ),
            mapOf<Int, View>(1 to homePage, 2 to posterPage),
            cancelBtn, saveBtn,
            { openDonate(ctx) },
        )
        val pages = FrameLayout(ctx).apply {
            if (!wide) pageViews.forEach { addView(it, MATCH_PARENT, MATCH_PARENT) }
        }
        var current = if (wide) 1 else 0
        showPage = { i ->
            if (shell != null) {
                current = if (i == 0) 1 else i
                shell.select(current, focus = false)
            } else {
                val prev = current
                current = i
                pageViews.forEachIndexed { idx, v -> v.visibility = if (idx == i) View.VISIBLE else View.GONE }
                header.visibility = if (i == 0) View.VISIBLE else View.GONE
                if (i == 0) refreshMenu()
                if (!pages.isInTouchMode) {
                    val target: View = if (i == 0 && prev >= 1) (menuCards[prev] ?: menuList) else pageViews[i]
                    target.requestFocus()
                }
            }
        }
        showPage(current)
        dialog.handleBack = {
            when {
                shell != null && dialog.currentFocus != null && shell.contentHasFocus(dialog.currentFocus) -> shell.focusSidebar()
                !wide && current >= 1 -> showPage(0)
                isDirty() -> confirmExit()
                else -> dialog.dismiss()
            }
        }

        val root: View = shell?.root ?: LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            background = ambientBg()
            val maxW = minOf(ctx.resources.displayMetrics.widthPixels, dp(ctx, 640))
            underHeader(header, menuScroll)
            aboveDock(actions, pageViews)
            addView(FrameLayout(ctx).apply {
                addView(pages, FrameLayout.LayoutParams(maxW, MATCH_PARENT, Gravity.CENTER_HORIZONTAL))
                addView(header, FrameLayout.LayoutParams(maxW, WRAP_CONTENT, Gravity.TOP or Gravity.CENTER_HORIZONTAL))
                addView(actions, FrameLayout.LayoutParams(maxW, WRAP_CONTENT, Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL))
            }, LinearLayout.LayoutParams(maxW, 0, 1f).apply { gravity = Gravity.CENTER_HORIZONTAL })
        }
        dialog.setContentView(root)
        dialog.window?.apply {
            setBackgroundDrawable(ambientBg())
            addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS)
            setSystemBarColors(C.BG)
        }
        dialog.onMenuKey = { (if (saveBtn.isEnabled) saveBtn else cancelBtn).requestFocus() }

        (1 until pageViews.size).forEach { initFps[it] = fingerprint(pageViews[it]) }
        refreshMenu()
        refreshDirty()
        dialog.show()
        dialog.rebuildOnLayoutChange(ctx) { show(ctx) }

        val ui = android.os.Handler(android.os.Looper.getMainLooper())
        val watcher = object : Runnable {
            override fun run() {
                if (!dialog.isShowing) return
                refreshDirty()
                if (current == 0) refreshMenu()
                if (shell != null) (1 until pageViews.size).forEach { shell.setEdited(it, isEdited(it)) }
                ui.postDelayed(this, if (isTv(ctx)) 400L else 250L)
            }
        }
        ui.post(watcher)

        root.post {
            if (!root.isInTouchMode) {
                if (shell != null) shell.focusSidebar() else pageViews[current].requestFocus()
            }
        }
    }
}
