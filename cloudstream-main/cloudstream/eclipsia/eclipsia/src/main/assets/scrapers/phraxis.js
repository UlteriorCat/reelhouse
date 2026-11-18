function getStreams(tmdbId, mediaType, season, episode) {
    var BASE_URL = "https://play4u.org";
    var USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36";
    var TMDB_URL = "https://api.themoviedb.org/3";
    var TMDB_KEY = (typeof TMDB_API_KEY !== "undefined" && TMDB_API_KEY) || "307b7b8ef035c6aa336900aef4e203bd";

    function mark(seen, key) {
        var slot = "$" + key;
        if (seen[slot]) return false;
        seen[slot] = true;
        return true;
    }

    function parseJson(text) {
        try {
            return JSON.parse(text);
        } catch (error) {
            return null;
        }
    }

    function pad(number) {
        var text = String(number);
        while (text.length < 2) text = "0" + text;
        return text;
    }

    function buildQuery(id, type, seasonValue, episodeValue) {
        var cleanId = String(id || "").trim();
        if (!/^tt\d+$/.test(cleanId) && !/^\d+$/.test(cleanId)) return null;
        var isSeries = type === "tv";
        if (isSeries && (seasonValue == null || episodeValue == null)) return null;
        return { id: cleanId, isSeries: isSeries, season: seasonValue, episode: episodeValue };
    }

    function fetchText(url, headers) {
        return Promise.resolve().then(function () {
            return fetch(url, { headers: headers });
        }).then(function (res) {
            return res.ok ? res.text() : null;
        }).then(null, function () {
            return null;
        });
    }

    function decodeBase64(text) {
        var input = text.replace(/[\t\n\f\r ]/g, "");
        if (input.length % 4 === 0) input = input.replace(/={1,2}$/, "");
        if (input.length % 4 === 1 || /[^A-Za-z0-9+\/]/.test(input)) return null;
        var alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        var out = [];
        var buffer = 0;
        var count = 0;
        for (var i = 0; i < input.length; i++) {
            buffer = (buffer << 6) | alphabet.indexOf(input.charAt(i));
            count += 6;
            if (count >= 8) {
                count -= 8;
                out.push((buffer >> count) & 255);
                buffer &= (1 << count) - 1;
            }
        }
        return out;
    }

    function unsealUrl(value) {
        if (typeof value !== "string") throw new Error("url");
        if (value.indexOf("pa!~") !== 0) return value;
        var key = "pa4u-stream-seal-v1";
        var base64 = value.slice(4).replace(/-/g, "+").replace(/_/g, "/");
        for (var padding = (4 - base64.length % 4) % 4; padding > 0; padding--) base64 += "=";
        var bytes = decodeBase64(base64);
        if (!bytes) return "";
        var text = "";
        for (var i = 0; i < bytes.length; i++) {
            text += String.fromCharCode(bytes[i] ^ key.charCodeAt(i % key.length));
        }
        return text;
    }

    function resolveImdbId(query) {
        if (/^tt\d+$/.test(query.id)) return Promise.resolve(query.id);
        return fetchText(TMDB_URL + "/" + (query.isSeries ? "tv" : "movie") + "/" + query.id + "/external_ids?api_key=" + encodeURIComponent(TMDB_KEY), {
            "User-Agent": USER_AGENT,
            "Accept": "application/json"
        }).then(function (text) {
            var data = parseJson(text);
            return data && data.imdb_id ? data.imdb_id : null;
        });
    }

    function extractPlayerState(html) {
        var marker = html.indexOf("window.__PA_PLAY__");
        var start = marker < 0 ? -1 : html.indexOf("{", marker);
        if (start < 0) return null;
        for (var end = html.indexOf("}", start); end >= 0; end = html.indexOf("}", end + 1)) {
            var state = parseJson(html.slice(start, end + 1));
            if (state !== null || html.slice(start, end + 1) === "null") return state;
        }
        return null;
    }

    function heightOf(stream) {
        var heights = (stream.qualities || []).map(function (quality) {
            var match = String(quality.label || quality.slug || "").match(/\d{3,4}/);
            return parseInt(quality.height, 10) || (match ? parseInt(match[0], 10) : 0);
        });
        var best = 0;
        for (var i = 0; i < heights.length; i++) best = Math.max(best, heights[i]);
        return best;
    }

    function labelOf(stream) {
        var names = (stream.languages || []).map(function (language) {
            return language && language.name;
        }).filter(Boolean);
        if (names.length > 2) return "Play4u \u2022 Multi-Dub";
        return names.length ? "Play4u \u2022 " + names.join(" \u2022 ") : "Play4u";
    }

    function gather(html) {
        var state = html && extractPlayerState(html);
        if (!state || !state.ok || !Array.isArray(state.streams)) return [];
        var seen = {};
        return state.streams.filter(function (stream) {
            return stream && stream.m3u8_url;
        }).map(function (stream) {
            return { height: heightOf(stream), url: unsealUrl(stream.m3u8_url), label: labelOf(stream) };
        }).filter(function (entry) {
            return entry.height >= 1080 && entry.url && mark(seen, entry.url);
        }).map(function (entry, index) {
            return { entry: entry, index: index };
        }).sort(function (a, b) {
            return b.entry.height - a.entry.height || a.index - b.index;
        }).map(function (item) {
            return {
                name: item.entry.label,
                title: item.entry.label,
                url: item.entry.url,
                quality: item.entry.height >= 2160 ? "4K" : item.entry.height + "p",
                type: "hls",
                headers: { "User-Agent": USER_AGENT, "Referer": BASE_URL + "/", "Origin": BASE_URL }
            };
        });
    }

    var query = buildQuery(tmdbId, mediaType, season, episode);
    if (!query) return Promise.resolve([]);
    return resolveImdbId(query).then(function (imdbId) {
        if (!imdbId) return [];
        var pageUrl = query.isSeries
            ? BASE_URL + "/series/" + imdbId + "/s-" + pad(query.season) + "/ep-" + pad(query.episode)
            : BASE_URL + "/watch/" + imdbId;
        return fetchText(pageUrl, { "User-Agent": USER_AGENT, "Referer": BASE_URL + "/" }).then(gather);
    }).then(null, function () {
        return [];
    });
}

module.exports = { getStreams: getStreams };