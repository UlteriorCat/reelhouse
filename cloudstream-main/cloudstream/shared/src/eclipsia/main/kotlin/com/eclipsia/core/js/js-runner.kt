package com.eclipsia.core.js

import com.eclipsia.core.map.JsStream
import org.json.JSONArray

class ScraperRef(val id: String, val path: String)

interface JsRunner {
    suspend fun callScraper(ref: ScraperRef, tmdbId: String, mediaType: String, season: Int?, episode: Int?): List<JsStream>
    suspend fun settingsLayout(ref: ScraperRef): JSONArray
}

interface JsEnv {
    fun tmdbKey(): String
    fun settingsJson(scraperId: String): String
    fun concurrency(): Int
}
