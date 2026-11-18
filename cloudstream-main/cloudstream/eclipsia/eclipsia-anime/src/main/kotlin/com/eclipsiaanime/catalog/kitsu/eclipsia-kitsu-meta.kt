package com.eclipsiaanime

import com.eclipsia.core.json.text
import com.eclipsia.core.json.objects
import com.eclipsia.core.net.FetchTuning
import com.eclipsia.core.net.RawResponse
import com.eclipsia.core.net.jsonFetcher
import com.lagradost.cloudstream3.app
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import org.json.JSONObject
import java.net.URLEncoder

internal object EclipsiaKitsuMeta {
    private const val BASE = "https://kitsu.io/api/edge"
    private const val TIMEOUT_MS = 6_000L
    private const val PAGE = 20
    private const val MAX_PAGES = 15
    private const val MAX_SEASONS = 12
    const val LIST_TTL_MS = 3 * 60 * 1000L
    private const val META_TTL_MS = 30 * 60 * 1000L

    private val http = jsonFetcher(FetchTuning(parallel = 6, maxEntries = 160))
    private val headers = mapOf("Accept" to "application/vnd.api+json")
    private val placeholder = Regex("""(?i)episode\s*\d+""")

    suspend fun get(path: String, ttlMs: Long = META_TTL_MS): JSONObject? {
        val url = "$BASE/$path"
        return http.get(url, ttlMs, accept = { it.has("data") }) {
            val resp = app.get(url, headers = headers, timeout = TIMEOUT_MS)
            RawResponse(resp.code, if (resp.code in 200..299) resp.text else null, resp.headers["Retry-After"])
        }
    }

    fun enc(s: String): String = URLEncoder.encode(s, "UTF-8")

    private fun entryOf(o: JSONObject): MetaEntry? {
        val id = o.text("id") ?: return null
        val at = o.optJSONObject("attributes") ?: return null
        val poster = at.optJSONObject("posterImage")
        return MetaEntry(
            id, cleanSynopsis(at.text("synopsis") ?: at.text("description")),
            at.optInt("episodeCount", 0).takeIf { it > 0 },
            poster?.text("original") ?: poster?.text("large"),
        )
    }

    private fun titlesOf(at: JSONObject): List<String> {
        val list = ArrayList<String>()
        at.optJSONObject("titles")?.let { t -> t.keys().forEach { k -> t.text(k)?.let(list::add) } }
        at.text("canonicalTitle")?.let(list::add)
        at.optJSONArray("abbreviatedTitles")?.let { a ->
            for (i in 0 until a.length()) a.optString(i).takeIf { it.isNotBlank() }?.let(list::add)
        }
        return list
    }

    suspend fun find(titles: List<String>, year: Int?, movie: Boolean): MetaEntry? {
        val wanted = titles.map(::normTitle).filter { it.isNotEmpty() }.toSet()
        if (wanted.isEmpty()) return null
        for (title in titles.distinct().take(3)) {
            val hit = get("anime?filter%5Btext%5D=${enc(title)}&page%5Blimit%5D=10")
                ?.optJSONArray("data").objects().firstOrNull { o ->
                    val at = o.optJSONObject("attributes") ?: return@firstOrNull false
                    if (at.text("subtype").equals("movie", true) != movie) return@firstOrNull false
                    val y = at.text("startDate")?.take(4)?.toIntOrNull()
                    if (year != null && y != null && kotlin.math.abs(y - year) > 1) return@firstOrNull false
                    titlesOf(at).any { normTitle(it) in wanted }
                } ?: continue
            return entryOf(hit)
        }
        return null
    }

    private suspend fun sequel(id: String): MetaEntry? {
        val root = get("anime/$id/media-relationships?filter%5Brole%5D=sequel&include=destination&page%5Blimit%5D=10") ?: return null
        val next = root.optJSONArray("included").objects().firstOrNull {
            it.optString("type") == "anime" &&
                it.optJSONObject("attributes")?.text("subtype")?.lowercase() in SEQUEL_TYPES
        } ?: return null
        return entryOf(next)
    }

    private val SEQUEL_TYPES = setOf("tv", "ona")

    private suspend fun episodes(entry: MetaEntry): Map<Int, MetaEp> {
        fun path(offset: Int) =
            "anime/${entry.id}/episodes?sort=number&fields%5Bepisodes%5D=number,titles,canonicalTitle,synopsis,thumbnail,airdate,length" +
                "&page%5Blimit%5D=$PAGE&page%5Boffset%5D=$offset"
        val first = get(path(0)) ?: return emptyMap()
        val total = first.optJSONObject("meta")?.optInt("count", 0) ?: 0
        val pages = ((total + PAGE - 1) / PAGE).coerceIn(1, MAX_PAGES)
        val rest = if (pages > 1) coroutineScope {
            (1 until pages).map { p -> async { get(path(p * PAGE)) } }.awaitAll()
        } else emptyList()
        val out = LinkedHashMap<Int, MetaEp>()
        for (page in listOf(first) + rest) {
            for (o in page?.optJSONArray("data").objects()) {
                val at = o.optJSONObject("attributes") ?: continue
                val n = at.optInt("number", 0).takeIf { it > 0 } ?: continue
                val t = at.optJSONObject("titles")
                val title = (t?.text("en_us") ?: t?.text("en") ?: at.text("canonicalTitle") ?: t?.text("en_jp"))
                    ?.takeUnless { it.matches(placeholder) }
                out[n] = MetaEp(
                    title,
                    cleanSynopsis(at.text("synopsis")),
                    at.optJSONObject("thumbnail")?.text("original"),
                    at.text("airdate"),
                    at.optInt("length", 0).takeIf { it > 0 },
                )
            }
        }
        return out
    }

    suspend fun forSeasons(first: MetaEntry, seasons: List<Pair<Int, Int>>): Map<Int, Map<Int, MetaEp>> = coroutineScope {
        val wanted = seasons.take(MAX_SEASONS)
        val out = HashMap<Int, Map<Int, MetaEp>>()
        var entry: MetaEntry? = first
        for ((index, season) in wanted.withIndex()) {
            val e = entry ?: break
            val (number, tmdbCount) = season
            val next = if (index < wanted.lastIndex) async { sequel(e.id) } else null
            val kc = e.episodeCount
            if (kc == null || kotlin.math.abs(kc - tmdbCount) <= maxOf(2, tmdbCount / 5)) {
                val eps = episodes(e)
                if (eps.isNotEmpty()) out[number] = eps
            }
            entry = next?.await()
        }
        out
    }
}
