package com.eclipsia

import com.eclipsia.core.catalog.EclipsiaIMDbApi
import com.eclipsia.core.ui.Fonts
import com.eclipsia.core.ui.*

import android.content.Context
import com.eclipsia.core.AppRestart
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.view.WindowManager
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.json.JSONObject

object EclipsiaSettingsUi {
    private val uiScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    fun show(ctx: Context) {
        val dialog = SettingsDialog(ctx)
        var backdropRef: java.lang.ref.WeakReference<View>? = null
        val modalBackdrop: () -> View? = { backdropRef?.get() }
        val scrapers = EclipsiaRepository.allScrapers()
        val toggles = ArrayList<Pair<EclipsiaScraper, ToggleView>>()

        val wide = isWideLayout(ctx)
        fun pageColumn() = settingsPageColumn(ctx, wide)

        val perfList = pageColumn()
        val catList = pageColumn()
        val tmdbList = pageColumn()
        val posterList = pageColumn()
        val homeList = pageColumn()
        val menuList = pageColumn()
        var showPage: (Int) -> Unit = {}
        val provList = pageColumn().apply { setPadding(paddingLeft, dp(ctx, Sp.S), paddingRight, paddingBottom) }

        val subtitle = text(ctx, "", 14f, C.TEXT_DIM)
        fun refreshSubtitle() {
            val on = toggles.count { it.second.checked }
            subtitle.text = "$on of ${scrapers.size} providers enabled"
        }

        val dirtyChip = text(ctx, "●  Unsaved changes", 13f, WARN, bold = true).apply { visibility = View.GONE }
        val header = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            if (!wide) background = headerScrim(ctx)
            setPadding(dp(ctx, 24), vGap(ctx, 0.015f, 8, 20), dp(ctx, 24), dp(ctx, 20))
            if (!wide) {
                addView(brandText(ctx, "Eclipsia", 32f))
                addView(subtitle, lp(ctx, top = 6))
            }
        }

        val perf = SearchTuning(
            ctx, EclipsiaStore, true,
            "whole search stops, however many providers are active. Links already found are kept.",
            modalBackdrop
        )
        perf.addTo(perfList)
        val limits = StreamLimits(ctx, EclipsiaStore, scrapers.map { it.id to it.name }, modalBackdrop)
        limits.addTo(perfList)
        perfList.addView(button(ctx, "Reset to defaults", filled = false) {
            perf.reset()
            limits.reset()
            toast(ctx, "Performance reset. Press Save to apply")
        }, LinearLayout.LayoutParams(MATCH_PARENT, dp(ctx, Sp.BTN_H)).apply { topMargin = dp(ctx, 32) })

        val tmdb = TmdbSettings(ctx, EclipsiaStore, EclipsiaStore.region, tmdbList)

        val poster = PosterSettings(ctx, EclipsiaStore, uiScope, "Movie and TV poster using the settings above", posterList)

        val tmdbEnabledToggle = ToggleView(ctx).apply { setChecked(EclipsiaStore.tmdbEnabled, false) }
        val allOff = !EclipsiaStore.tmdbEnabled && !EclipsiaStore.imdbEnabled
        val imdbEnabledToggle = ToggleView(ctx).apply { setChecked(EclipsiaStore.imdbEnabled || allOff, false) }
        val catalogToggleList = listOf(
            "Eclipsia" to tmdbEnabledToggle,
            "EclipsiaIMDb" to imdbEnabledToggle,
        )
        fun guardLastCatalog() {
            val on = catalogToggleList.count { it.second.checked }
            catalogToggleList.forEach { (_, t) ->
                t.isEnabled = !(on == 1 && t.checked)
                t.invalidate()
            }
        }
        val gCat = catList.childCount
        catalogToggleList.forEach { (label, toggle) ->
            toggle.onChange = { guardLastCatalog() }
            catList.addView(
                toggleCard(ctx, label, "Disabled: hidden after restarting the app", toggle),
                lp(ctx, top = Sp.GAP)
            )
        }
        regroup(ctx, catList, gCat)
        guardLastCatalog()

        var sourceChoice = EclipsiaStore.catalogSource
        val sourceChips = ArrayList<Pair<String, TextView>>()
        fun refreshSourceChips() = sourceChips.forEach { (key, chip) ->
            val sel = key == sourceChoice
            setChipSelected(chip, sel)
        }
        val sourceRow = LinearLayout(ctx).apply {
            listOf(EclipsiaStore.SOURCE_NUVIO to "Nuvio", EclipsiaStore.SOURCE_TMDB to "TMDb").forEach { (key, label) ->
                val chip = TextView(ctx).apply {
                    text = label; textSize = 14f
                    typeface = Fonts.medium; gravity = Gravity.CENTER
                    setPadding(dp(ctx, 18), 0, dp(ctx, 18), 0)
                    focusRing(ctx, this, 18, 1.03f)
                    setOnClickListener { sourceChoice = key; refreshSourceChips() }
                }
                sourceChips += key to chip
                addView(chip, LinearLayout.LayoutParams(WRAP_CONTENT, dp(ctx, 36)).apply { rightMargin = dp(ctx, 8) })
            }
        }
        refreshSourceChips()
        catList.addView(card(ctx).apply {
            setPadding(dp(ctx, 16), dp(ctx, 16), dp(ctx, 16), dp(ctx, 16))
            addView(text(ctx, "Eclipsia catalog source", 16f, C.TEXT, bold = true))
            addView(text(ctx, "Nuvio: fast home rows from catalog.nuvio.tv (Default & Recommended).\nTMDb: all rows straight from the TMDb API", 13f, C.TEXT_DIM), lp(ctx, top = 2))
            addView(sourceRow, lp(ctx, top = Sp.GAP))
        }, lp(ctx, top = Sp.GAP))

        val homeRows = RowsSettings(ctx, EclipsiaStore, homeList)
        listOf<Pair<String, () -> Unit>>(
            "Eclipsia" to { homeRows.add("tmdb", "Eclipsia", "Rows shown on the Eclipsia home page. Use the arrows to reorder", EclipsiaCatalog.titles) },
            "EclipsiaIMDb" to { homeRows.add("imdb", "EclipsiaIMDb", "Rows shown on the EclipsiaIMDb home page. Use the arrows to reorder", EclipsiaIMDbApi.titles, EclipsiaIMDbApi.labels) },
        ).sortedBy { it.first.lowercase() }.forEach { it.second() }
        homeList.addView(button(ctx, "Reset rows to default", filled = false) {
            homeRows.reset()
            toast(ctx, "Home rows reset. Press Save to apply")
        }, LinearLayout.LayoutParams(MATCH_PARENT, dp(ctx, Sp.BTN_H)).apply { topMargin = dp(ctx, 32) })

        fun saveTmdb() {
            EclipsiaStore.customPosterTemplate = poster.template
            EclipsiaStore.customPosterEnabled = poster.toggle.checked
            EclipsiaStore.hideLabels = poster.hideLabels.checked
            EclipsiaStore.tmdbKeyOverride = tmdb.keyText
            EclipsiaStore.tmdbPersonalEnabled = tmdb.personal.checked
            EclipsiaStore.region = tmdb.region
            EclipsiaStore.language = tmdb.language
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
        val catSub = text(ctx, "", 13f, C.TEXT_DIM)
        val tmdbSub = text(ctx, "", 13f, C.TEXT_DIM)
        val posterSub = text(ctx, "", 13f, C.TEXT_DIM)
        val homeSub = text(ctx, "", 13f, C.TEXT_DIM)
        fun refreshMenu() {
            val atOnce = if (perf.auto.checked) "${toggles.count { it.second.checked }.coerceAtLeast(1)} at once (Auto)"
            else "${perf.concurrency} at once"
            perfSub.text = editedText(
                "$atOnce \u2022 " + (if (perf.timeout == EclipsiaStore.TIMEOUT_AUTO) "Auto timeout" else "${perf.timeout}s timeout"),
                isEdited(2)
            )
            catSub.text = editedText(
                catalogToggleList.filter { it.second.checked }.joinToString(" + ") { it.first }.ifBlank { "None enabled" },
                isEdited(3)
            )
            tmdbSub.text = editedText(
                (if (tmdb.personal.checked) "Personal key" else "Built-in key") +
                    " \u2022 ${tmdb.region.trim().ifBlank { "US" }}" +
                    " \u2022 ${tmdb.language.trim().ifBlank { EclipsiaStore.DEFAULT_LANGUAGE }}",
                isEdited(4)
            )
            posterSub.text = editedText(
                (if (poster.toggle.checked) "Custom poster" else "TMDb posters") +
                    (if (poster.hideLabels.checked) " \u2022 Labels hidden" else ""),
                isEdited(5)
            )
            val hidden = homeRows.hiddenCount
            homeSub.text = editedText(if (hidden == 0) "All rows shown" else "$hidden rows hidden", isEdited(6))
        }
        refreshMenu()
        menuList.addView(supportCard(ctx), lp(ctx, top = Sp.XS))
        menuList.addView(sectionLabel(ctx, "Search"))
        val gSearch = menuList.childCount
        menuList.addView(
            menuCard(ctx, IconView.Kind.BOLT, C.ICON, "Performance", perfSub) { showPage(2) }.also { menuCards[2] = it },
            lp(ctx, top = 0)
        )
        regroup(ctx, menuList, gSearch)
        menuList.addView(sectionLabel(ctx, "Content"))
        val gContent = menuList.childCount
        menuList.addView(
            menuCard(ctx, IconView.Kind.GRID, C.ICON, "Catalog", catSub) { showPage(3) }.also { menuCards[3] = it },
            lp(ctx, top = 0)
        )
        menuList.addView(
            menuCard(ctx, IconView.Kind.LIST, C.ICON, "Home", homeSub) { showPage(6) }.also { menuCards[6] = it },
            lp(ctx, top = Sp.GAP)
        )
        menuList.addView(
            menuCard(ctx, IconView.Kind.IMAGE, C.ICON, "Poster", posterSub) { showPage(5) }.also { menuCards[5] = it },
            lp(ctx, top = Sp.GAP)
        )
        regroup(ctx, menuList, gContent)
        menuList.addView(sectionLabel(ctx, "Accounts"))
        menuList.addView(
            menuCard(ctx, IconView.Kind.KEY, C.ICON, "TMDb", tmdbSub) { showPage(4) }.also { menuCards[4] = it },
            lp(ctx, top = 0)
        )

        val categories = EclipsiaRepository.CATEGORIES
        fun keyOf(sc: EclipsiaScraper) = sc.id.substringAfter(':')
        val catKeys = scrapers.filter { sc -> categories.any { it.id == sc.category } }.map { keyOf(it) }.toSet()
        var syncing = false
        val catSync = ArrayList<() -> Unit>()
        val memberCards = HashMap<String, View>()
        val catBox = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }
        val holderSync = ArrayList<() -> Unit>()
        fun syncHolders() = holderSync.forEach { it() }

        val chipRow = LinearLayout(ctx).apply {
            EclipsiaRepository.PRESETS.forEach { preset ->
                addView(chip(ctx, preset.label) {
                        toggles.forEach { (sc, t) ->
                            if (!sc.manifestEnabled) return@forEach
                            val listed = keyOf(sc) in preset.providerIds
                            if (keyOf(sc) !in catKeys) t.setChecked(listed, false)
                            else if (listed) t.setChecked(true, false)
                        }
                        catSync.forEach { it() }
                        syncHolders()
                }, LinearLayout.LayoutParams(WRAP_CONTENT, dp(ctx, 36)).apply { rightMargin = dp(ctx, 8) })
            }
        }
        val catCards = ArrayList<Pair<List<EclipsiaScraper>, View>>()
        var query = ""
        var applyFilter: () -> Unit = {}
        val providerViews = ArrayList<Pair<EclipsiaScraper, View>>()
        var enableAllBtn: TextView? = null
        var disableAllBtn: TextView? = null
        fun matches(sc: EclipsiaScraper) = query.isEmpty() ||
            sc.name.contains(query, ignoreCase = true) || (sc.description ?: "").contains(query, ignoreCase = true)
        if (categories.isNotEmpty()) {
            provList.addView(sectionLabel(ctx, "Categories", first = true))
            provList.addView(catBox)
        }
        provList.addView(sectionLabel(ctx, "Providers"))
        if (EclipsiaRepository.PRESETS.isNotEmpty()) {
            provList.addView(android.widget.HorizontalScrollView(ctx).apply {
                isHorizontalScrollBarEnabled = false
                addView(chipRow)
            }, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
        }

        fun setAll(on: Boolean) {
            toggles.forEach { (sc, t) ->
                if (sc.manifestEnabled && keyOf(sc) !in catKeys && matches(sc)) t.setChecked(on, false)
            }
        }
        provList.addView(LinearLayout(ctx).apply {
            addView(
                button(ctx, "Enable all", filled = true) { setAll(true) }.also { enableAllBtn = it },
                LinearLayout.LayoutParams(0, dp(ctx, 44), 1f).apply { rightMargin = dp(ctx, 6) })
            addView(
                button(ctx, "Disable all", filled = false) { setAll(false) }.also { disableAllBtn = it },
                LinearLayout.LayoutParams(0, dp(ctx, 44), 1f).apply { leftMargin = dp(ctx, 6) })
        }, lp(ctx, top = Sp.GAP))

        val plainRows = ArrayList<View>()
        if (scrapers.isEmpty()) provList.addView(text(ctx, "No providers bundled.", 15f, C.TEXT_DIM))
        scrapers.forEach { sc ->
            val toggle = ToggleView(ctx).apply {
                setChecked(EclipsiaStore.isEnabled(sc.id, sc.manifestEnabled, sc.defaultEnabled), false)
                isEnabled = sc.manifestEnabled
                onChange = { refreshSubtitle() }
            }
            toggles += sc to toggle
            val card = providerCard(ctx, sc.name, sc.description, sc.hasSettings, toggle) { scraperSettings(ctx, sc, modalBackdrop) }
            providerViews += sc to card
            if (keyOf(sc) in catKeys) memberCards[keyOf(sc)] = card
            else plainRows += card
        }
        if (plainRows.isNotEmpty()) provList.addView(group(ctx, plainRows), lp(ctx, top = Sp.GAP))

        categories.forEach { cat ->
            val members = scrapers.filter { it.category == cat.id }
                .mapNotNull { sc -> toggles.firstOrNull { it.first.id == sc.id } }
            if (members.isEmpty()) return@forEach
            var bulk = false
            val inner = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }
            val memberRows = members.mapNotNull { memberCards[keyOf(it.first)] }
            if (memberRows.isNotEmpty()) inner.addView(group(ctx, memberRows), lp(ctx, top = Sp.M))
            val holder = LinearLayout(ctx).apply {
                orientation = LinearLayout.HORIZONTAL
                visibility = if (members.any { it.second.checked }) View.VISIBLE else View.GONE

                addView(View(ctx).apply {
                    background = GradientDrawable().apply { setColor(C.OUTLINE); cornerRadius = dp(ctx, 1).toFloat() }
                }, LinearLayout.LayoutParams(dp(ctx, 2), MATCH_PARENT).apply {
                    leftMargin = dp(ctx, Sp.L); topMargin = dp(ctx, Sp.M)
                })
                addView(inner, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f).apply { leftMargin = dp(ctx, Sp.M) })
            }
            val catToggle = ToggleView(ctx).apply {
                setChecked(members.any { it.second.checked }, false)
                onChange = { on ->
                    if (!syncing) {
                        bulk = true
                        members.forEach { it.second.setChecked(on, false) }
                        bulk = false
                    }
                    syncHolders()
                }
            }
            fun syncCategory() {
                val any = members.any { it.second.checked }
                if (catToggle.checked != any) {
                    syncing = true
                    catToggle.setChecked(any, false)
                    syncing = false
                }
                syncHolders()
            }
            catSync += { syncCategory() }

            members.forEach { m ->
                val previous = m.second.onChange
                m.second.onChange = { on ->
                    previous?.invoke(on)
                    if (!bulk) syncCategory()
                }
            }
            val catCard = card(ctx).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                minimumHeight = dp(ctx, Sp.ROW_MIN)
                setPadding(dp(ctx, Sp.L), dp(ctx, 14), dp(ctx, Sp.M), dp(ctx, 14))
                addView(LinearLayout(ctx).apply {
                    orientation = LinearLayout.VERTICAL
                    addView(text(ctx, cat.label, 16f, C.TEXT, bold = true))
                    if (cat.bannerText.isNotBlank()) addView(
                        text(ctx, cat.bannerText, 13f, C.TEXT_DIM).apply { setLineSpacing(0f, 1.25f) },
                        lp(ctx, top = 4)
                    )
                }, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f).apply { rightMargin = dp(ctx, Sp.M) })
                addView(catToggle, LinearLayout.LayoutParams(dp(ctx, 52), dp(ctx, 32)))
                rowFocus(ctx, this, catToggle)
            }
            holderSync += {
                holder.visibility = when {
                    query.isNotEmpty() -> if (members.any { matches(it.first) }) View.VISIBLE else View.GONE
                    members.any { it.second.checked } -> View.VISIBLE
                    else -> View.GONE
                }
            }
            catCards += members.map { it.first } to catCard
            catBox.addView(catCard, lp(ctx, top = Sp.GAP))
            catBox.addView(holder)
        }
        syncHolders()
        refreshSubtitle()

        applyFilter = {
            providerViews.forEach { (sc, v) -> v.visibility = if (matches(sc)) View.VISIBLE else View.GONE }
            catCards.forEach { (members, v) ->
                v.visibility = if (query.isEmpty() || members.any { matches(it) }) View.VISIBLE else View.GONE
            }
            enableAllBtn?.text = if (query.isEmpty()) "Enable all" else "Enable shown"
            disableAllBtn?.text = if (query.isEmpty()) "Disable all" else "Disable shown"
            syncHolders()
        }

        fun stateSnapshot(): String = listOf<Any?>(
            perf.concurrency,
            perf.auto.checked,
            perf.timeout,
            limits.total,
            limits.perProvider.checked,
            limits.providerCaps.toSortedMap().toString(),
            tmdb.keyText,
            tmdb.personal.checked,
            tmdb.region,
            tmdb.language,
            poster.template,
            poster.toggle.checked,
            poster.hideLabels.checked,
            tmdbEnabledToggle.checked,
            imdbEnabledToggle.checked,
            sourceChoice,
            homeRows.togglesState,
            homeRows.orderState,
            toggles.joinToString { "${it.first.id}=${it.second.checked}" },
        ).joinToString("\u0001")
        val initialState = stateSnapshot()

        fun saveAll() {
            perf.save()
            limits.save()
            val posterChanged = poster.toggle.checked != EclipsiaStore.customPosterEnabled
            saveTmdb()
            EclipsiaStore.catalogSource = sourceChoice
            val providersChanged = EclipsiaStore.imdbEnabled != imdbEnabledToggle.checked ||
                EclipsiaStore.tmdbEnabled != tmdbEnabledToggle.checked
            EclipsiaStore.imdbEnabled = imdbEnabledToggle.checked
            EclipsiaStore.tmdbEnabled = tmdbEnabledToggle.checked
            homeRows.save()
            toggles.forEach { (sc, t) -> EclipsiaStore.setEnabled(sc.id, t.checked) }
            toast(
                ctx,
                when {
                    posterChanged -> "Saved. Restarting to apply poster changes"
                    providersChanged -> "Saved. Restarting to apply provider changes"
                    else -> "Saved"
                },
            )
            dialog.dismiss()
            if (posterChanged || providersChanged) AppRestart.restart(ctx) { EclipsiaStore.flush() }
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

        val provScroll = ScrollView(ctx).apply { isVerticalScrollBarEnabled = false; addView(provList) }
        val menuScroll = ScrollView(ctx).apply { isVerticalScrollBarEnabled = false; addView(menuList) }
        val perfPage = subPage(ctx, "Performance", "Search speed, Time & Stream limits", perfList) { showPage(1) }
        val catPage = subPage(ctx, "Catalog", "Eclipsia and EclipsiaIMDb", catList) { showPage(1) }
        val tmdbPage = subPage(ctx, "TMDb", "API key, Region and Language", tmdbList) { showPage(1) }
        val posterPage = subPage(ctx, "Poster", "Custom poster, labels and Preview", posterList) { showPage(1) }
        val homePage = subPage(ctx, "Home", "Show, hide and reorder rows", homeList) { showPage(1) }
        val pageViews = listOf<View>(provScroll, menuScroll, perfPage, catPage, tmdbPage, posterPage, homePage)
        pageViewsRef = pageViews
        val shell: WideShell? = if (!wide) null else WideShell(
            ctx, "Eclipsia", subtitle, dirtyChip,
            listOf(
            NavEntry(0, IconView.Kind.PLUG, "Providers", "Providers", "Choose which sources are searched"),
            NavEntry(2, IconView.Kind.BOLT, "Performance", "Performance", "Search speed and stream limits"),
            NavEntry(3, IconView.Kind.GRID, "Catalog", "Catalog", "Eclipsia and EclipsiaIMDb"),
            NavEntry(6, IconView.Kind.LIST, "Home rows", "Home rows", "Show, hide and reorder rows"),
            NavEntry(5, IconView.Kind.IMAGE, "Posters", "Posters", "Custom poster, labels and preview"),
            NavEntry(4, IconView.Kind.KEY, "TMDb", "TMDb", "API key, region and language")
            ),
            mapOf<Int, View>(0 to provScroll, 2 to perfPage, 3 to catPage, 6 to homePage, 5 to posterPage, 4 to tmdbPage),
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

    private fun scraperSettings(ctx: Context, s: EclipsiaScraper, modalBackdrop: () -> View?) {
        uiScope.launch {
            val layout = EclipsiaEngine.runner.settingsLayout(EclipsiaRepository.ref(s))
            val saved = runCatching { JSONObject(EclipsiaStore.settingsJson(s.id)) }.getOrDefault(JSONObject())
            val box = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }
            val collect = mutableListOf<(JSONObject) -> Unit>()

            val rows = ArrayList<View>()

            var afterLabel = true
            fun gap() = if (box.childCount == 0 || afterLabel) 0 else Sp.L
            fun flushRows() {
                if (rows.isEmpty()) return
                box.addView(group(ctx, ArrayList(rows)), lp(ctx, top = gap()))
                afterLabel = false
                rows.clear()
            }
            fun note(msg: String, top: Int = 0) = text(ctx, msg, 13f, C.TEXT_DIM).apply {
                setLineSpacing(0f, 1.25f)
                setPadding(dp(ctx, Sp.S), dp(ctx, top), dp(ctx, Sp.S), 0)
            }

            for (i in 0 until layout.length()) {
                val f = layout.optJSONObject(i) ?: continue
                val key = f.optString("key")
                val labelText = f.optString("label")
                val desc = f.optString("description")
                when (f.optString("type", "info")) {
                    "header" -> {
                        flushRows()
                        box.addView(sectionLabel(ctx, labelText, first = box.childCount == 0))
                        afterLabel = true
                    }

                    "info", "" -> {
                        flushRows()
                        box.addView(note(labelText, top = if (box.childCount == 0 || afterLabel) 0 else Sp.M))
                        afterLabel = false
                    }

                    "text" -> {
                        flushRows()
                        box.addView(sectionLabel(ctx, labelText, first = box.childCount == 0))
                        afterLabel = true
                        val et = EditText(ctx).apply {
            typeface = Fonts.regular
            noFullscreenIme()
                            hint = f.optString("placeholder")
                            setText(saved.optString(key, ""))
                            textSize = 16f; setTextColor(C.TEXT); setHintTextColor(C.TEXT_FAINT)
                            background = null
                            setPadding(0, dp(ctx, 4), 0, dp(ctx, 4))
                        }
                        box.addView(fieldCard(ctx, et))
                        if (desc.isNotBlank()) box.addView(note(desc, top = Sp.S))
                        afterLabel = false
                        collect += { out -> out.put(key, et.text.toString()) }
                    }

                    "toggle" -> {
                        val t = ToggleView(ctx).apply {
                            setChecked(
                                if (saved.has(key)) saved.optBoolean(key) else f.optBoolean("defaultValue", false),
                                false
                            )
                        }
                        rows += toggleCard(ctx, labelText, desc, t)
                        collect += { out -> out.put(key, t.checked) }
                    }

                    "select" -> {
                        val opts = f.optJSONArray("options")
                        val values = ArrayList<String>()
                        val labels = ArrayList<String>()
                        if (opts != null) for (j in 0 until opts.length()) {
                            val o = opts.optJSONObject(j) ?: continue
                            values += o.optString("value")
                            labels += o.optString("label", o.optString("value"))
                        }
                        var selected = values.indexOf(
                            if (saved.has(key)) saved.optString(key) else f.optString("defaultValue", "")
                        ).coerceAtLeast(0)
                        val value = text(ctx, labels.getOrElse(selected) { "" }, 15f, C.TEXT)
                        rows += selectRow(ctx, labelText, desc, value) {
                            if (labels.isEmpty()) return@selectRow
                            pickerSheet(ctx, labelText, s.name, labels, selected, modalBackdrop) { which ->
                                selected = which
                                value.text = labels[which]
                            }
                        }
                        collect += { out -> if (values.isNotEmpty()) out.put(key, values[selected]) }
                    }

                    else -> Unit
                }
            }
            flushRows()
            if (layout.length() == 0) box.addView(text(ctx, "This provider has no settings.", 15f, C.TEXT_DIM))

            modalSheet(
                ctx, s.name, "Provider settings", kind = IconView.Kind.PLUG, tint = C.PRIMARY, backdrop = modalBackdrop,
                onConfirm = {
                    val out = JSONObject()
                    collect.forEach { it(out) }
                    EclipsiaStore.saveSettings(s.id, out.toString())
                    toast(ctx, "Saved")
                }
            ) { box }
        }
    }

}
