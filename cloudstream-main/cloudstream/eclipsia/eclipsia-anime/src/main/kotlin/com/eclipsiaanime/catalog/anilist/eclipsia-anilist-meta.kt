package com.eclipsiaanime

import com.eclipsia.core.json.text
import com.eclipsia.core.json.objects
import com.eclipsia.core.net.FetchTuning
import com.eclipsia.core.net.RawResponse
import com.eclipsia.core.net.jsonFetcher
import com.lagradost.cloudstream3.app
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

internal object EclipsiaAnilistMeta {
    private const val URL = "https://graphql.anilist.co"
    private const val TIMEOUT_MS = 6_000L
    private const val MAX_SEASONS = 12
    const val LIST_TTL_MS = 3 * 60 * 1000L
    private const val META_TTL_MS = 30 * 60 * 1000L

    private val http = jsonFetcher(FetchTuning(parallel = 3, maxEntries = 120))
    private val headers = mapOf("Accept" to "application/json", "Content-Type" to "application/json")
    private val mediaType = "application/json".toMediaTypeOrNull()

    const val LIST_FRAGMENT = """
        fragment L on Media {
            id idMal format seasonYear
            startDate { year }
            title { romaji english native }
            synonyms
            coverImage { extraLarge large }
        }
    """

    private const val FULL_FIELDS = """
        id idMal format status episodes seasonYear
        startDate { year }
        title { romaji english native }
        synonyms
        description(asHtml: false)
        coverImage { extraLarge large }
    """

    suspend fun query(gql: String, variables: JSONObject, ttlMs: Long = META_TTL_MS): JSONObject? {
        val body = JSONObject().put("query", gql).put("variables", variables).toString()
        val root = http.get(body, ttlMs, accept = { it.optJSONObject("data") != null }) {
            val resp = app.post(
                URL,
                headers = headers,
                requestBody = body.toRequestBody(mediaType),
                timeout = TIMEOUT_MS,
            )
            RawResponse(resp.code, if (resp.code in 200..299) resp.text else null, resp.headers["Retry-After"])
        }
        return root?.optJSONObject("data")
    }

    fun titlesOf(o: JSONObject): List<String> {
        val list = ArrayList<String>()
        o.optJSONObject("title")?.let { t -> listOf("english", "romaji", "native").forEach { k -> t.text(k)?.let(list::add) } }
        o.optJSONArray("synonyms")?.let { a ->
            for (i in 0 until a.length()) a.optString(i).takeIf { it.isNotBlank() }?.let(list::add)
        }
        return list.distinct()
    }

    fun yearOf(o: JSONObject): Int? =
        o.optInt("seasonYear", 0).takeIf { it > 0 } ?: o.optJSONObject("startDate")?.optInt("year", 0)?.takeIf { it > 0 }

    private fun entryOf(o: JSONObject): MetaEntry? {
        val id = o.opt("id")?.toString()?.takeIf { it != "null" } ?: return null
        val c = o.optJSONObject("coverImage")
        return MetaEntry(
            id, cleanSynopsis(o.text("description"), html = true),
            o.optInt("episodes", 0).takeIf { it > 0 },
            c?.text("extraLarge") ?: c?.text("large"),
        )
    }

    suspend fun find(titles: List<String>, year: Int?, movie: Boolean): MetaEntry? {
        val wanted = titles.map(::normTitle).filter { it.isNotEmpty() }.toSet()
        if (wanted.isEmpty()) return null
        val searches = titles.distinct().take(3)
        val sig = searches.indices.joinToString(", ") { "\$s$it: String" }
        val body = searches.indices.joinToString(" ") {
            "t$it: Page(page: 1, perPage: 10) { media(search: \$s$it, type: ANIME, sort: SEARCH_MATCH) { $FULL_FIELDS } }"
        }
        val vars = JSONObject().also { v -> searches.forEachIndexed { i, s -> v.put("s$i", s) } }
        val data = query("query($sig) { $body }", vars) ?: return null
        for (i in searches.indices) {
            val hit = data.optJSONObject("t$i")?.optJSONArray("media").objects().firstOrNull { o ->
                if (o.text("format").equals("MOVIE", true) != movie) return@firstOrNull false
                val y = yearOf(o)
                if (year != null && y != null && kotlin.math.abs(y - year) > 1) return@firstOrNull false
                titlesOf(o).any { normTitle(it) in wanted }
            } ?: continue
            return entryOf(hit)
        }
        return null
    }

    private val EP_RE = Regex("""^\s*(?:episode|ep\.?|e)\s*(\d+)\s*(?:[-:–—]\s*(.*))?$""", RegexOption.IGNORE_CASE)
    private val SEQUEL_FORMATS = setOf("TV", "ONA")

    private class Step(val episodes: Map<Int, MetaEp>, val next: MetaEntry?)

    private suspend fun step(entry: MetaEntry, needEpisodes: Boolean, needNext: Boolean): Step? {
        val id = entry.id.toIntOrNull() ?: return null
        val parts = buildString {
            if (needEpisodes) append("streamingEpisodes { title thumbnail } ")
            if (needNext) append("relations { edges { relationType node { $FULL_FIELDS } } }")
        }
        val media = query(
            "query(\$id: Int) { Media(id: \$id, type: ANIME) { $parts } }",
            JSONObject().put("id", id),
        )?.optJSONObject("Media") ?: return null

        val eps = LinkedHashMap<Int, MetaEp>()
        if (needEpisodes) {
            for (o in media.optJSONArray("streamingEpisodes").objects()) {
                val m = EP_RE.find(o.text("title") ?: continue) ?: continue
                val n = m.groupValues[1].toIntOrNull()?.takeIf { it > 0 } ?: continue
                val title = m.groupValues[2].trim().takeIf { it.isNotEmpty() }
                eps.putIfAbsent(n, MetaEp(title, null, o.text("thumbnail"), null, null))
            }
        }
        val next = if (needNext) {
            media.optJSONObject("relations")?.optJSONArray("edges").objects().firstOrNull {
                it.optString("relationType") == "SEQUEL" && it.optJSONObject("node")?.text("format") in SEQUEL_FORMATS
            }?.optJSONObject("node")?.let(::entryOf)
        } else null
        return Step(eps, next)
    }

    suspend fun forSeasons(first: MetaEntry, seasons: List<Pair<Int, Int>>): Map<Int, Map<Int, MetaEp>> {
        val wanted = seasons.take(MAX_SEASONS)
        val out = HashMap<Int, Map<Int, MetaEp>>()
        var entry: MetaEntry? = first
        for ((index, season) in wanted.withIndex()) {
            val e = entry ?: break
            val (number, tmdbCount) = season
            val kc = e.episodeCount
            val needEpisodes = kc == null || kotlin.math.abs(kc - tmdbCount) <= maxOf(2, tmdbCount / 5)
            val needNext = index < wanted.lastIndex
            if (!needEpisodes && !needNext) break
            val result = step(e, needEpisodes, needNext)
            if (result == null) {
                if (needNext) break else continue
            }
            if (result.episodes.isNotEmpty()) out[number] = result.episodes
            entry = result.next
        }
        return out
    }
}
