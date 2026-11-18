function getStreams(tmdbId, mediaType, season, episode) {
    var BASE_URL = "https://pc7mud.movielinkbd.at";
    var TMDB_API = "https://api.themoviedb.org/3";
    var TMDB_KEY = (typeof TMDB_API_KEY !== "undefined" && TMDB_API_KEY) || "307b7b8ef035c6aa336900aef4e203bd";
    var USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36";
    var HTML_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
    var STREAM_HEADERS = { "User-Agent": USER_AGENT, "Referer": BASE_URL + "/" };
    var BROWSER_EXTRA = {
        "Accept-Language": "en-US,en;q=0.9",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1"
    };
    var QUALITY_RANK = { "2160p": 2, "1080p": 1 };

    function parseNumber(value) {
        var number = parseInt(value, 10);
        return isNaN(number) ? 1 : number;
    }

    function buildQuery() {
        if (!/^\d+$/.test(String(tmdbId))) return null;
        return {
            id: String(tmdbId),
            type: mediaType === "movie" ? "movie" : "tv",
            season: parseNumber(season),
            episode: parseNumber(episode)
        };
    }

    function httpGet(url, headers) {
        return Promise.resolve().then(function () {
            return fetch(url, { method: "GET", headers: headers });
        }).then(function (response) {
            return response.text().then(function (body) {
                return { status: response.status, body: body };
            });
        }).then(null, function () {
            return null;
        });
    }

    function buildHeaders(referer, accept, extra) {
        var headers = { "User-Agent": USER_AGENT, "Accept": accept, "Referer": referer };
        if (extra) {
            var keys = Object.keys(extra);
            for (var i = 0; i < keys.length; i++) headers[keys[i]] = extra[keys[i]];
        }
        return headers;
    }

    function normalizeTitle(value) {
        return String(value == null ? "" : value)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, " ")
            .trim();
    }

    function stripHtmlTags(html) {
        return html
            .replace(/<[^>]+>/g, " ")
            .replace(/&amp;/g, "&")
            .replace(/&#039;/g, "'")
            .replace(/&quot;/g, "\"")
            .replace(/\s+/g, " ")
            .trim();
    }

    function parseSearchCard(text) {
        var yearMatch = text.match(/\(((?:19|20)\d{2})\)/);
        var seasonMatch = text.match(/\bS(\d{1,2})\b/i) || text.match(/Season\s*(\d{1,2})/i);
        return {
            normalizedTitle: normalizeTitle(text.replace(/\[[^\]]*\]|\(\d{4}\)|\bS\d{1,2}\b|Season\s*\d{1,2}|\bCompleted\b/gi, " ")),
            year: yearMatch ? parseInt(yearMatch[1], 10) : null,
            season: seasonMatch ? parseInt(seasonMatch[1], 10) : null
        };
    }

    function parseSearchResults(html, type) {
        var cards = [];
        var visitedPaths = Object.create(null);
        var linkPattern = /<a[^>]*href="(\/(?:movie|series|anime|drama)\/[^"]+)"[^>]*>([\s\S]{0,800}?)<\/a>/g;
        var match;
        while ((match = linkPattern.exec(html)) !== null) {
            var path = match[1];
            if (visitedPaths[path] || (type === "movie") !== (path.indexOf("/movie/") === 0)) continue;
            var text = stripHtmlTags(match[2]);
            if (!text) continue;
            visitedPaths[path] = true;
            var card = parseSearchCard(text);
            card.path = path;
            cards.push(card);
        }
        return cards;
    }

    function isYearCompatible(cardYear, tmdbYear) {
        return cardYear == null || tmdbYear == null || Math.abs(cardYear - tmdbYear) <= 1;
    }

    function multiply32(a, b) {
        var ah = (a >>> 16) & 65535;
        var al = a & 65535;
        var bh = (b >>> 16) & 65535;
        var bl = b & 65535;
        return (al * bl + (((ah * bl + al * bh) << 16) >>> 0)) | 0;
    }

    function decodeBase64(text) {
        var alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        var clean = text.replace(/=+$/, "");
        var bytes = [];
        var buffer = 0;
        var bits = 0;
        for (var i = 0; i < clean.length; i++) {
            var index = alphabet.indexOf(clean.charAt(i));
            if (index === -1) throw new Error("base64");
            buffer = (buffer << 6) | index;
            bits += 6;
            if (bits >= 8) {
                bits -= 8;
                bytes.push((buffer >> bits) & 255);
                buffer &= (1 << bits) - 1;
            }
        }
        return bytes;
    }

    function decodeUtf8(bytes) {
        var encoded = "";
        for (var i = 0; i < bytes.length; i++) {
            encoded += "%" + (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16);
        }
        return decodeURIComponent(encoded);
    }

    function decodeObfuscatedPayload(encodedPayload, seedHex, roundCount) {
        try {
            var state = parseInt(seedHex, 16) >>> 0;
            var next = function () {
                state = (multiply32(state, 1103515245) + 12345) >>> 0;
                return state;
            };
            for (var round = parseInt(roundCount, 10); round > 0; round--) next();
            var binary = decodeBase64(encodedPayload.replace(/\s+/g, ""));
            var bytes = new Uint8Array(binary.length);
            for (var position = 0; position < binary.length; position++) {
                bytes[position] = binary[position] ^ ((next() >>> 16) & 255);
            }
            var payload = JSON.parse(decodeUtf8(bytes));
            return Array.isArray(payload && payload.episodes) ? payload : null;
        } catch (error) {
            return null;
        }
    }

    function extractPlayerPayload(html) {
        var scriptPattern = /<script([^>]*)>([\s\S]*?)<\/script>/g;
        var match;
        while ((match = scriptPattern.exec(html)) !== null) {
            var seedMatch = match[1].match(/data-s\s*=\s*["']([0-9a-fA-F]+)["']/);
            var roundsMatch = match[1].match(/data-r\s*=\s*["'](\d+)["']/);
            if (seedMatch && roundsMatch) {
                return decodeObfuscatedPayload(match[2], seedMatch[1], roundsMatch[1]);
            }
        }
        return null;
    }

    function fetchPlayerPayload(url, referer) {
        var attempts = [null, BROWSER_EXTRA].map(function (extra) {
            return httpGet(url, buildHeaders(referer, HTML_ACCEPT, extra)).then(function (response) {
                return response && response.status === 200 ? extractPlayerPayload(response.body) : null;
            });
        });
        return Promise.all(attempts).then(function (payloads) {
            return payloads[0] || payloads[1] || null;
        });
    }

    function fetchTmdbDetails(type, id) {
        var url = TMDB_API + "/" + type + "/" + id + "?api_key=" + TMDB_KEY;
        return httpGet(url, buildHeaders("", "application/json, text/plain, */*")).then(function (response) {
            if (!response || response.status !== 200) return null;
            try {
                return JSON.parse(response.body);
            } catch (error) {
                return null;
            }
        });
    }

    function select(list, test) {
        for (var i = 0; i < list.length; i++) {
            if (test(list[i])) return list[i];
        }
        return undefined;
    }

    function findEpisodeEntry(payload, type, seasonNumber, episodeNumber) {
        var rows = payload.episodes;
        if (type === "movie") {
            return select(rows, function (entry) {
                return entry.kind === "movie";
            }) || rows[0];
        }
        return select(rows, function (entry) {
            return entry.season === seasonNumber && entry.number === episodeNumber;
        }) || (seasonNumber === 1 ? select(rows, function (entry) {
            return entry.number === episodeNumber;
        }) : undefined);
    }

    function getSortTag(rank) {
        var highest = 0;
        var names = Object.keys(QUALITY_RANK);
        for (var i = 0; i < names.length; i++) {
            if (QUALITY_RANK[names[i]] > highest) highest = QUALITY_RANK[names[i]];
        }
        var inverted = (highest - rank).toString(2);
        while (inverted.length < 20) inverted = "0" + inverted;
        return inverted.replace(/1/g, "\uFEFF").replace(/0/g, "\u200B");
    }

    function toStreams(sources) {
        var seenUrls = Object.create(null);
        var kept = [];
        for (var i = 0; i < sources.length; i++) {
            var source = sources[i];
            if (!source || typeof source.url !== "string" || !source.url || seenUrls[source.url]) continue;
            var rawQuality = String(source.quality == null ? "" : source.quality).toLowerCase();
            if (!/2160|1080|4k/.test(rawQuality)) continue;
            seenUrls[source.url] = true;
            var quality = /1080/.test(rawQuality) ? "1080p" : "2160p";
            var sortTag = getSortTag(QUALITY_RANK[quality]);
            kept.push({
                index: kept.length,
                stream: {
                    name: sortTag + "MovieLinkBD \u2022 " + quality,
                    title: sortTag + "MovieLinkBD \u2022 " + quality,
                    url: source.url,
                    quality: quality,
                    headers: { "User-Agent": STREAM_HEADERS["User-Agent"], "Referer": STREAM_HEADERS["Referer"] }
                }
            });
        }
        kept.sort(function (a, b) {
            return (QUALITY_RANK[b.stream.quality] - QUALITY_RANK[a.stream.quality]) || (a.index - b.index);
        });
        return kept.map(function (entry) {
            return entry.stream;
        });
    }

    var query = buildQuery();
    if (!query) return Promise.resolve([]);

    return fetchTmdbDetails(query.type, query.id).then(function (details) {
        var title = details && (details.title || details.name);
        if (!title) return [];

        var tmdbYear = parseInt((details.release_date || details.first_air_date || "").slice(0, 4), 10) || null;
        var normalizedTitle = normalizeTitle(title);
        var searchUrl = BASE_URL + "/search?q=" + encodeURIComponent(title);

        return httpGet(searchUrl, buildHeaders(BASE_URL + "/", HTML_ACCEPT)).then(function (searchResponse) {
            if (!searchResponse || searchResponse.status !== 200) return [];

            var cards = parseSearchResults(searchResponse.body, query.type).filter(function (card) {
                return card.normalizedTitle === normalizedTitle &&
                    isYearCompatible(card.year, tmdbYear) &&
                    (query.type === "movie" || card.season === query.season);
            });

            return Promise.all(cards.map(function (card) {
                return fetchPlayerPayload(BASE_URL + card.path, searchUrl);
            })).then(function (payloads) {
                for (var i = 0; i < payloads.length; i++) {
                    var entry = payloads[i] && findEpisodeEntry(payloads[i], query.type, query.season, query.episode);
                    if (!entry || !Array.isArray(entry.sources)) continue;
                    var streams = toStreams(entry.sources);
                    if (streams.length) return streams;
                }
                return [];
            });
        });
    }).then(null, function () {
        return [];
    });
}

module.exports = { getStreams: getStreams };