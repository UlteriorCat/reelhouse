function getStreams(tmdbId, mediaType, season, episode) {
    var PROVIDER = "DhakaFlix FTP";
    var TMDB_API = 'https://api.themoviedb.org/3';
    var TMDB_KEY = (typeof TMDB_API_KEY !== "undefined" && TMDB_API_KEY) || "307b7b8ef035c6aa336900aef4e203bd";
    var SERVERS = [
        { url: "http://172.16.50.12", root: "/DHAKA-FLIX-12/" },
        { url: "http://172.16.50.14", root: "/DHAKA-FLIX-14/" }
    ];
    var HEADERS = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
        "Content-Type": "application/json"
    };
    var AUDIO_TABLE = [
        [/ddp.?51.*truehd.*71|truehd.*71.*ddp.?51/i, "DDP 5.1 + TrueHD 7.1"],
        [/ddp.?51.*ddp.?71|ddp.?71.*ddp.?51/i, "DDP 5.1 + DDP 7.1"],
        [/ddp.?51.*aac.?71|aac.?71.*ddp.?51/i, "DDP 5.1 + AAC 7.1"],
        [/ddp.?51/i, "DDP 5.1"],
        [/truehd/i, "TrueHD 7.1"],
        [/aac.*71|71.*aac/i, "AAC 7.1"],
        [/aac/i, "AAC 5.1"]
    ];
    var QUALITY_RANK = { '2160p': 5, '1440p': 4, '1080p': 3, '720p': 2, '480p': 0, 'hd': -1 };
    var MAX_RANK = 5;

    function buildQuery() {
        if (!/^\d+$/.test(String(tmdbId))) return null;
        if (mediaType !== "movie" && mediaType !== "tv") return null;
        if (!TMDB_KEY) return null;
        if (mediaType === "movie") {
            return { tmdbId: tmdbId, mediaType: "movie", season: null, episode: null };
        }
        if (season == null || episode == null) return null;
        return { tmdbId: tmdbId, mediaType: "tv", season: season, episode: episode };
    }

    function httpGet(url) {
        return fetch(url, { headers: HEADERS }).then(function (res) {
            return res.ok ? res.json() : null;
        }).then(null, function () {
            return null;
        });
    }

    function httpPost(url, body) {
        return fetch(url, {
            method: "POST",
            headers: HEADERS,
            body: JSON.stringify(body)
        }).then(function (res) {
            return res.ok ? res.json() : null;
        }).then(null, function () {
            return null;
        });
    }

    function getTmdbMeta(query) {
        var url = TMDB_API + "/" + (query.mediaType === "tv" ? "tv" : "movie") + "/" + query.tmdbId + "?api_key=" + TMDB_KEY;
        return httpGet(url).then(function (data) {
            if (!data) return null;
            return {
                title: data.title || data.name || "",
                year: (data.release_date || data.first_air_date || "").slice(0, 4)
            };
        });
    }

    function parseQuality(filename) {
        var s = filename.toLowerCase();
        if (s.indexOf("2160p") !== -1 || s.indexOf("4k") !== -1) return "2160p";
        if (s.indexOf("1080p") !== -1) return "1080p";
        if (s.indexOf("720p") !== -1) return "720p";
        if (s.indexOf("480p") !== -1) return "480p";
        return "hd";
    }

    function buildSearchVariants(title) {
        var clean = title.replace(/[^a-zA-Z0-9 ]/g, "").trim();
        return [
            clean.replace(/ /g, "\\ "),
            clean.replace(/ /g, ".")
        ];
    }

    function passesMediaTypeFilter(href) {
        var s = href.toLowerCase();
        if (mediaType === "movie") {
            return s.indexOf("tv-web-series") === -1 && s.indexOf("tv series") === -1;
        }
        return s.indexOf("english movies") === -1 && s.indexOf("hindi movies") === -1 && s.indexOf("movies") === -1;
    }

    function pad(value) {
        var s = String(value);
        return s.length < 2 ? "0" + s : s;
    }

    function passesEpisodeFilter(filename, seasonNumber, episodeNumber) {
        return new RegExp("s" + pad(seasonNumber) + "[. _-]?e" + pad(episodeNumber), "i").test(filename);
    }

    function hasSuffix(text, suffix) {
        return text.length >= suffix.length && text.slice(text.length - suffix.length) === suffix;
    }

    function isVideo(href) {
        return hasSuffix(href, ".mkv") || hasSuffix(href, ".mp4") || hasSuffix(href, ".avi");
    }

    function sortTag(rank) {
        var bin = Math.max(0, MAX_RANK - rank).toString(2);
        var out = "";
        while (bin.length < 20) bin = "0" + bin;
        for (var i = 0; i < bin.length; i++) {
            out += bin.charAt(i) === "1" ? "\uFEFF" : "\u200B";
        }
        return out;
    }

    function languageOf(combined) {
        var parts = [];
        if (/\b(?:english|eng)\b/.test(combined)) parts.push("English");
        if (/\bhindi\b/.test(combined)) parts.push("Hindi");
        if (/\btamil\b/.test(combined)) parts.push("Tamil");
        if (/\btelugu\b/.test(combined)) parts.push("Telugu");
        return parts;
    }

    function sourceOf(combined) {
        if (/\bbluray\b/.test(combined)) return "Blu-ray";
        if (/\b(?:webrip|hdrip)\b/.test(combined)) return "WEB-Rip";
        return "WEB-DL";
    }

    function hdrOf(combined) {
        if (/\bhdr10\+|hdr10p\b/.test(combined)) return "HDR10+";
        if (/\bhdr10\b/.test(combined)) return "HDR10";
        if (/\bhdr\b/.test(combined)) return "HDR";
        if (/\bsdr\b/.test(combined)) return "SDR";
        return "";
    }

    function audioOf(combined) {
        var audio = "DDP 5.1";
        for (var i = 0; i < AUDIO_TABLE.length; i++) {
            if (AUDIO_TABLE[i][0].test(combined)) {
                audio = AUDIO_TABLE[i][1];
                break;
            }
        }
        if (/\batmos\b/.test(combined)) audio += " Atmos";
        return audio;
    }

    function makeStream(filename, streamUrl, quality) {
        var combined = (filename + " " + streamUrl).toLowerCase();
        var bit10Tag = /\b10bit\b/.test(combined) ? "10Bit" : "";
        var dvTag = /\b(?:dv|dolby\s*vision)\b/.test(combined) ? "DV" : "";
        var codec = /\b(?:hevc|x265|265)\b/.test(combined) ? "H.265" : "H.264";
        var isImax = /\bimax\b/.test(combined);
        var rank = QUALITY_RANK[quality];
        var tag = sortTag(rank === undefined ? -1 : rank);
        var qualityUp = quality.toUpperCase();

        var line1 = languageOf(combined).join(" \u2022 ");
        var line2 = [sourceOf(combined), isImax && "IMAX", "BDIX"].filter(Boolean).join(" \u2022 ");
        var line3 = [bit10Tag, dvTag, hdrOf(combined), codec, audioOf(combined)].filter(Boolean).join(" \u2022 ");

        return {
            name: tag + PROVIDER + " \u2022 " + qualityUp,
            title: tag + PROVIDER + " \u2022 " + qualityUp,
            size: [line1, line2, line3].filter(Boolean).join("\n"),
            url: streamUrl,
            quality: quality,
            headers: { "User-Agent": HEADERS["User-Agent"] }
        };
    }

    function toStreams(server, data, query) {
        if (!data || !Array.isArray(data.search)) return [];
        var streams = [];
        for (var i = 0; i < data.search.length; i++) {
            var item = data.search[i];
            var filename = decodeURIComponent(item.href.split("/").pop());
            var lower = filename.toLowerCase();
            if (!isVideo(item.href.toLowerCase())) continue;
            if (!passesMediaTypeFilter(item.href)) continue;
            if (query.mediaType === "tv" && !passesEpisodeFilter(lower, query.season, query.episode)) continue;
            if (query.mediaType === "movie" && query.year && lower.indexOf(query.year) === -1) continue;
            streams.push(makeStream(filename, server.url + item.href, parseQuality(filename)));
        }
        return streams;
    }

    function queryServer(server, pattern, query) {
        return httpPost(server.url + server.root, {
            action: "get",
            search: {
                href: server.root,
                ignorecase: true,
                pattern: pattern
            }
        }).then(function (data) {
            try {
                return toStreams(server, data, query);
            } catch (e) {
                return [];
            }
        });
    }

    function probeServers(variants, query) {
        var jobs = [];
        var v;
        var s;
        for (v = 0; v < variants.length; v++) {
            for (s = 0; s < SERVERS.length; s++) {
                jobs.push(queryServer(SERVERS[s], variants[v], query));
            }
        }
        return Promise.all(jobs).then(function (batches) {
            for (var vi = 0; vi < variants.length; vi++) {
                var seen = Object.create(null);
                var streams = [];
                for (var si = 0; si < SERVERS.length; si++) {
                    var batch = batches[vi * SERVERS.length + si];
                    for (var k = 0; k < batch.length; k++) {
                        var stream = batch[k];
                        if (!stream.url || seen[stream.url]) continue;
                        seen[stream.url] = true;
                        streams.push(stream);
                    }
                }
                if (streams.length > 0) return streams;
            }
            return [];
        });
    }

    function run() {
        var query = buildQuery();
        if (!query) return [];
        return getTmdbMeta(query).then(function (meta) {
            if (!meta || !meta.title) return [];
            query.year = query.mediaType === "movie" ? meta.year : null;
            return probeServers(buildSearchVariants(meta.title), query);
        });
    }

    return Promise.resolve().then(run).then(null, function () {
        return [];
    });
}

module.exports = { getStreams: getStreams };
