package com.eclipsiaanime

import com.eclipsia.core.json.text
import com.eclipsia.core.json.objects
import com.eclipsia.core.catalog.EclipsiaTmdb
import com.eclipsia.core.catalog.EclipsiaPosters
import com.lagradost.cloudstream3.*
import com.lagradost.cloudstream3.LoadResponse.Companion.addImdbId
import com.lagradost.cloudstream3.LoadResponse.Companion.addTrailer
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import org.json.JSONObject

internal object EclipsiaDetails {
    private const val IMAGE = "https://image.tmdb.org/t/p"
    private const val DETAIL_TTL_MS = 30 * 60 * 1000L
    private const val SEASON_CHUNK = 5
    private const val MAX_CAST = 50
    private const val MAX_TRAILERS = 5
    private val LINK_PATTERN = Regex("""themoviedb\.org/(movie|tv)/(\d+)""")
    private val ONGOING = setOf("Returning Series", "In Production", "Planned", "Pilot")

    private class Ref(val isTv: Boolean, val id: Int)

    private fun refOf(url: String): Ref? {
        LINK_PATTERN.find(url)?.let { return Ref(it.groupValues[1] == "tv", it.groupValues[2].toInt()) }
        val json = runCatching { JSONObject(url) }.getOrNull() ?: return null
        val id = json.optInt("tmdbID").takeIf { it > 0 } ?: return null
        return Ref(json.has("season") || json.has("episode"), id)
    }

    private fun image(path: String?, size: String): String? =
        path?.takeIf { it.startsWith("/") }?.let { "$IMAGE/$size$it" }

    private fun payload(imdb: String?, id: Int, season: Int?, episode: Int?, name: String?): String =
        JSONObject().apply {
            imdb?.let { put("imdbID", it) }
            put("tmdbID", id)
            season?.let { put("season", it) }
            episode?.let { put("episode", it) }
            name?.let { put("movieName", it) }
        }.toString()

    private suspend fun plotOf(kind: String, id: Int, detail: JSONObject): String? {
        detail.text("overview")?.let { return it }
        if (!EclipsiaStore.language.startsWith("en")) {
            EclipsiaTmdb.getJson("$kind/$id?language=en-US", DETAIL_TTL_MS)?.text("overview")?.let { return it }
        }
        return detail.text("tagline")
    }

    private fun ageRating(detail: JSONObject): String? {
        val regions = listOf("US")
        val tv = detail.optJSONObject("content_ratings")?.optJSONArray("results").objects()
        val movie = detail.optJSONObject("release_dates")?.optJSONArray("results").objects()
        for (region in regions) {
            tv.firstOrNull { it.optString("iso_3166_1") == region }?.text("rating")?.let { return it }
            movie.firstOrNull { it.optString("iso_3166_1") == region }
                ?.optJSONArray("release_dates").objects()
                .firstNotNullOfOrNull { it.text("certification") }
                ?.let { return it }
        }
        return null
    }

    private fun trailers(detail: JSONObject): List<String> {
        val videos = detail.optJSONObject("videos")?.optJSONArray("results").objects()
            .filter { it.optString("site").let { s -> s.isEmpty() || s == "YouTube" } }
        fun link(v: JSONObject) = v.text("key")?.let { "https://www.youtube.com/watch?v=$it" }
        val onlyTrailers = videos.filter { it.optString("type") == "Trailer" }.mapNotNull(::link).reversed()
        return onlyTrailers.ifEmpty { videos.mapNotNull(::link) }.take(MAX_TRAILERS)
    }

    private fun cast(detail: JSONObject): List<ActorData> =
        detail.optJSONObject("credits")?.optJSONArray("cast").objects().take(MAX_CAST).mapNotNull { c ->
            val name = c.text("name") ?: c.text("original_name") ?: return@mapNotNull null
            ActorData(Actor(name, image(c.text("profile_path"), "w185")), roleString = c.text("character"))
        }

    private fun logoOf(detail: JSONObject): String? {
        val logos = detail.optJSONObject("images")?.optJSONArray("logos").objects()
            .filter { it.text("file_path") != null }
        if (logos.isEmpty()) return null

        fun isSvg(o: JSONObject) = o.optString("file_path").endsWith(".svg", ignoreCase = true)
        fun url(o: JSONObject) = "$IMAGE/w500${o.optString("file_path")}"

        val own = logos.filter { it.optString("iso_639_1").trim().lowercase() == EclipsiaStore.languageCode }
        own.firstOrNull { !isSvg(it) }?.let { return url(it) }
        own.firstOrNull { isSvg(it) }?.let { return url(it) }

        val voted = logos.filter { it.optDouble("vote_average", 0.0) > 0 && it.optInt("vote_count", 0) > 0 }
        val ranking = compareByDescending<JSONObject> { it.optDouble("vote_average", 0.0) }
            .thenByDescending { it.optInt("vote_count", 0) }
        voted.filter { !isSvg(it) }.minWithOrNull(ranking)?.let { return url(it) }
        return voted.filter { isSvg(it) }.minWithOrNull(ranking)?.let { url(it) }
    }

    private suspend fun fetchDetail(ref: Ref, kind: String, lang: String): JSONObject? {
        val code = EclipsiaStore.languageCode
        val extras = buildString {
            append("credits,external_ids,videos,recommendations,images,")
            append(if (ref.isTv) "content_ratings" else "release_dates")
        }
        val query = "&language=$lang&include_image_language=$code,en,null&include_video_language=$code,en"
        return EclipsiaTmdb.getJson("$kind/${ref.id}?append_to_response=$extras$query", DETAIL_TTL_MS)
    }

    private fun episodesOf(season: JSONObject?): List<JSONObject>? =
        season?.optJSONArray("episodes")?.objects()

    private suspend fun fetchSeasonChunk(tvId: Int, chunk: List<Int>, lang: String): Map<Int, List<JSONObject>> {
        val out = HashMap<Int, List<JSONObject>>()
        if (chunk.size > 1) {
            val appended = chunk.joinToString(",") { "season/$it" }
            val root = EclipsiaTmdb.getJson("tv/$tvId?append_to_response=$appended&language=$lang", DETAIL_TTL_MS)
            for (n in chunk) episodesOf(root?.optJSONObject("season/$n"))?.let { out[n] = it }
        }
        val still = chunk.filter { it !in out }
        if (still.isEmpty()) return out
        coroutineScope {
            still.map { n -> async { n to episodesOf(EclipsiaTmdb.getJson("tv/$tvId/season/$n?language=$lang", DETAIL_TTL_MS)) } }
                .awaitAll()
                .forEach { (n, eps) -> if (eps != null) out[n] = eps }
        }
        return out
    }

    private suspend fun seasonsOf(tvId: Int, detail: JSONObject, lang: String): List<Pair<Int, List<JSONObject>>> {
        val wanted = detail.optJSONArray("seasons").objects()
            .filter { it.optInt("episode_count", 1) > 0 }
            .map { it.optInt("season_number", -1) }
            .filter { it > 0 }
            .distinct()
            .sorted()

        val have = HashMap<Int, List<JSONObject>>()
        val missing = ArrayList<Int>()
        for (n in wanted) {
            val eps = episodesOf(detail.optJSONObject("season/$n"))
            if (eps != null) have[n] = eps else missing += n
        }
        if (missing.isNotEmpty()) {
            coroutineScope {
                missing.chunked(SEASON_CHUNK)
                    .map { chunk -> async { fetchSeasonChunk(tvId, chunk, lang) } }
                    .awaitAll()
            }.forEach { have.putAll(it) }
        }
        return wanted.mapNotNull { n -> have[n]?.let { n to it } }
    }

    suspend fun MainAPI.loadDetails(url: String, kitsu: Boolean = false, anilist: Boolean = false): LoadResponse? {
        val ref = refOf(url) ?: return null
        val kind = if (ref.isTv) "tv" else "movie"
        val lang = EclipsiaStore.language

        val detail = fetchDetail(ref, kind, lang) ?: return null
        val title = detail.text("title") ?: detail.text("name") ?: return null

        return coroutineScope {
            val seasonsJob = if (ref.isTv) async { seasonsOf(ref.id, detail, lang) } else null
            val plotJob = async { plotOf(kind, ref.id, detail) }

            val metaEntry = if (kitsu || anilist) {
                val names = listOf("name", "original_name", "title", "original_title").mapNotNull { detail.text(it) }.distinct()
                val y = (detail.text("release_date") ?: detail.text("first_air_date"))?.substringBefore('-')?.toIntOrNull()
                if (kitsu) EclipsiaKitsuMeta.find(names, y, !ref.isTv) else EclipsiaAnilistMeta.find(names, y, !ref.isTv)
            } else null

            val backdrop = image(detail.text("backdrop_path"), "w1280")
            val released = detail.text("release_date") ?: detail.text("first_air_date")
            val releaseYear = released?.substringBefore('-')?.toIntOrNull()
            val genreNames = detail.optJSONArray("genres").objects().mapNotNull { it.text("name") }
            val imdb = detail.optJSONObject("external_ids")?.text("imdb_id")
            EclipsiaPosters.remember(kind, ref.id, imdb)
            val rating = Score.from10(detail.optDouble("vote_average", 0.0))
            val logo = logoOf(detail)
            val age = ageRating(detail)
            val actorList = cast(detail)
            val trailerList = trailers(detail)

            val poster = EclipsiaPosters.resolve(kind, ref.id, imdb, metaEntry?.poster ?: image(detail.text("poster_path"), "w780"))
            val related = EclipsiaCatalog.entries(
                this@loadDetails, detail.optJSONObject("recommendations")?.optJSONArray("results"), kind,
            )
            val plotText = metaEntry?.synopsis ?: plotJob.await()

            if (seasonsJob == null) {
                return@coroutineScope newMovieLoadResponse(
                    title, url, TvType.Movie, payload(imdb, ref.id, null, null, title),
                ) {
                    posterUrl = poster
                    backgroundPosterUrl = backdrop
                    year = releaseYear
                    plot = plotText
                    duration = detail.optInt("runtime").takeIf { it > 0 }
                    contentRating = age
                    logoUrl = logo
                    tags = genreNames
                    score = rating
                    recommendations = related
                    actors = actorList
                    addTrailer(trailerList)
                    addImdbId(imdb)
                }
            }

            val seasonList = seasonsJob.await()
            val metaEps = if (metaEntry != null) {
                val counts = seasonList.map { it.first to it.second.size }
                if (kitsu) EclipsiaKitsuMeta.forSeasons(metaEntry, counts) else EclipsiaAnilistMeta.forSeasons(metaEntry, counts)
            } else emptyMap()
            val episodes = seasonList.flatMap { it.second }.map { ep ->
                val seasonNo = ep.optInt("season_number").takeIf { ep.has("season_number") }
                val episodeNo = ep.optInt("episode_number").takeIf { ep.has("episode_number") }
                val meta = metaEps[seasonNo]?.get(episodeNo)
                newEpisode(payload(imdb, ref.id, seasonNo, episodeNo, title)) {
                    name = meta?.title ?: ep.text("name")
                    season = seasonNo
                    episode = episodeNo
                    posterUrl = meta?.thumb ?: image(ep.text("still_path"), "w300") ?: backdrop ?: poster
                    score = Score.from10(ep.optDouble("vote_average", 0.0))
                    description = meta?.synopsis ?: ep.text("overview")
                    runTime = meta?.minutes ?: ep.optInt("runtime").takeIf { it > 0 }
                    addDate(meta?.airdate ?: ep.text("air_date"))
                }
            }

            newTvSeriesLoadResponse(title, url, TvType.TvSeries, episodes) {
                posterUrl = poster
                backgroundPosterUrl = backdrop
                year = releaseYear
                plot = plotText
                contentRating = age
                logoUrl = logo
                tags = genreNames
                score = rating
                showStatus = if (detail.optString("status") in ONGOING) ShowStatus.Ongoing else ShowStatus.Completed
                recommendations = related
                actors = actorList
                addTrailer(trailerList)
                addImdbId(imdb)
            }
        }
    }
}
