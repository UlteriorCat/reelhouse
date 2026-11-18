package com.eclipsia.core.catalog

import com.eclipsia.core.json.text
import com.eclipsia.core.json.objects
import com.eclipsia.core.json.strings
import com.lagradost.cloudstream3.*
import com.lagradost.cloudstream3.LoadResponse.Companion.addImdbId
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject

internal object EclipsiaIMDbDetails {
    private val LINK_PATTERN = Regex("""imdb\.com/title/(tt\d+)/?\?kind=(movie|series)""")
    private val YEAR_PATTERN = Regex("""(19|20)\d{2}""")
    private val CAST_SOURCES = listOf(
        "https://aiometadata.elfhosted.com/stremio/9197a4a9-2f5b-4911-845e-8704c520bdf7/meta",
        "https://94c8cb9f702d-tmdb-addon.baby-beamup.club/meta",
    )

    private fun payload(id: String, season: Int?, episode: Int?, name: String?): String =
        JSONObject().apply {
            put("imdbID", id)
            season?.let { put("season", it) }
            episode?.let { put("episode", it) }
            name?.let { put("movieName", it) }
        }.toString()

    private fun bold(text: String): String = buildString {
        for (ch in text) {
            val point = when (ch) {
                in 'A'..'Z' -> 0x1D5D4 + (ch - 'A')
                in 'a'..'z' -> 0x1D5EE + (ch - 'a')
                in '0'..'9' -> 0x1D7EC + (ch - '0')
                else -> ch.code
            }
            appendCodePoint(point)
        }
    }

    private fun releaseYear(meta: JSONObject): Int? =
        listOf("year", "releaseInfo", "released")
            .firstNotNullOfOrNull { key -> meta.text(key)?.let { YEAR_PATTERN.find(it)?.value?.toIntOrNull() } }

    private fun genresOf(meta: JSONObject): List<String> =
        meta.optJSONArray("genre").strings().ifEmpty { meta.optJSONArray("genres").strings() }

    private suspend fun castOf(kind: String, id: String): List<ActorData>? {
        for (source in CAST_SOURCES) {
            val body = try {
                withTimeoutOrNull(6_000L) { app.get("$source/$kind/$id.json").text }
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                null
            }
            if (body.isNullOrEmpty()) continue
            val members = runCatching { JSONObject(body) }.getOrNull()
                ?.optJSONObject("meta")?.optJSONObject("app_extras")?.optJSONArray("cast").objects()
            val actors = members.mapNotNull { m ->
                val name = m.text("name") ?: return@mapNotNull null
                ActorData(Actor(name, EclipsiaIMDbApi.proxy(m.text("photo"))), roleString = m.text("character"))
            }
            if (actors.isNotEmpty()) return actors
        }
        return null
    }

    suspend fun MainAPI.loadIMDb(url: String): LoadResponse? {
        val match = LINK_PATTERN.find(url) ?: return null
        val id = match.groupValues[1]
        val kind = match.groupValues[2]
        val meta = EclipsiaIMDbApi.fetch("meta/$kind/$id.json")?.optJSONObject("meta") ?: return null
        val title = meta.optJSONArray("aliases").strings().firstOrNull() ?: meta.text("name") ?: return null

        val cover = EclipsiaPosters.resolveImdb(kind, id, EclipsiaIMDbApi.proxy(meta.text("poster")))
        val backdrop = EclipsiaIMDbApi.proxy(meta.text("background"))
        val logo = EclipsiaIMDbApi.proxy(meta.text("logo"))
        val plotText = meta.text("description").let { text ->
            meta.text("awards")?.let { "[${bold(it)}] ${text.orEmpty()}" } ?: text
        }
        val year = releaseYear(meta)
        val tagList = genresOf(meta)
        val rating = meta.text("imdbRating")?.toDoubleOrNull()?.let { Score.from10(it) }
        val cast = castOf(kind, id)

        if (kind == "movie") {
            return newMovieLoadResponse(title, url, TvType.Movie, payload(id, null, null, title)) {
                posterUrl = cover
                backgroundPosterUrl = backdrop
                this.year = year
                plot = plotText
                logoUrl = logo
                tags = tagList
                score = rating
                contentRating = "IMDB"
                actors = cast
                addImdbId(id)
            }
        }

        val episodes = meta.optJSONArray("videos").objects().mapNotNull { v ->
            val seasonNo = v.optInt("season", -1)
            val episodeNo = if (v.has("episode")) v.optInt("episode", -1) else v.optInt("number", -1)
            if (seasonNo <= 0 || episodeNo <= 0) return@mapNotNull null
            newEpisode(payload(id, seasonNo, episodeNo, title)) {
                name = v.text("name") ?: v.text("title")
                season = seasonNo
                episode = episodeNo
                posterUrl = EclipsiaIMDbApi.proxy(v.text("thumbnail"))
                description = v.text("overview") ?: v.text("description")
                score = v.text("rating")?.toDoubleOrNull()?.let { Score.from10(it) }
                addDate((v.text("firstAired") ?: v.text("released"))?.substringBefore('T'))
            }
        }

        return newTvSeriesLoadResponse(title, url, TvType.TvSeries, episodes) {
            posterUrl = cover
            backgroundPosterUrl = backdrop
            this.year = year
            plot = plotText
            logoUrl = logo
            tags = tagList
            score = rating
            contentRating = "IMDB"
            actors = cast
            addImdbId(id)
        }
    }
}
