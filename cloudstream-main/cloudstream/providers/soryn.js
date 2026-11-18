function getStreams(tmdbId, mediaType, season, episode) {
    var PROVIDER = "Netmirror";
    var BASE_URL = "https://net27.cc";
    var TMDB_API = "https://api.themoviedb.org/3";
    var TMDB_KEY = (typeof TMDB_API_KEY !== "undefined" && TMDB_API_KEY) || "307b7b8ef035c6aa336900aef4e203bd";
    var USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36";
    var PLATFORM_MAP = {
        netflix: { ott: "nf" },
        primevideo: { ott: "pv" },
        hotstar: { ott: "hs" },
        disney: { ott: "hs" }
    };
    var NEW_TV_BASE_HEADERS = {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
        "X-Requested-With": "NetmirrorNewTV v1.0",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:155.0) Gecko/20100101 Firefox/155.0 /OS.GatuNewTV v1.0",
        "Accept": "application/json, text/plain, */*"
    };
    var PLAYBACK_HEADERS = {
        "Referer": "https://videodownloader.site/",
        "User-Agent": USER_AGENT
    };
    var NET27_HEADERS = {
        "Accept": "application/json, text/plain, */*",
        "Referer": BASE_URL + "/",
        "User-Agent": USER_AGENT
    };
    var NEW_TV_DOMAINS = [
        "aHR0cHM6Ly9tb2JpbGVkZXRlY3RzLmNvbQ==",
        "aHR0cHM6Ly9tb2JpbGVkZXR0LmFwcA==",
        "aHR0cHM6Ly9tb2JpZGV0ZWN0LmFydA==",
        "aHR0cHM6Ly9tb2JpZGV0ZWN0LmNj",
        "aHR0cHM6Ly9tb2JpZGV0ZWN0LmNsaWNr",
        "aHR0cHM6Ly9tb2JpZGV0ZWN0Lmluaw==",
        "aHR0cHM6Ly9tb2JpZGV0ZWN0LmxpdmU=",
        "aHR0cHM6Ly9tb2JpZGV0ZWN0LnBybw==",
        "aHR0cHM6Ly9tb2JpZGV0ZWN0LnNob3A=",
        "aHR0cHM6Ly9tb2JpZGV0ZWN0LnNpdGU=",
        "aHR0cHM6Ly9tb2JpZGV0ZWN0LnNwYWNl",
        "aHR0cHM6Ly9tb2JpZGV0ZWN0LnN0b3Jl",
        "aHR0cHM6Ly9tb2JpZGV0ZWN0LnZpcA==",
        "aHR0cHM6Ly9tb2JpZGV0ZWN0Lndpa2k=",
        "aHR0cHM6Ly9tb2JpZGV0ZWN0Lnh5eg==",
        "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5hcnQ=",
        "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5jYw==",
        "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5pbmZv",
        "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5pbks=",
        "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5saXZl",
        "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5wcm8=",
        "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5zdG9yZQ==",
        "aHR0cHM6Ly9tb2JpZGV0ZWN0cy50b3A=",
        "aHR0cHM6Ly9tb2JpZGV0ZWN0cy54eXo="
    ];
    var BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    var apiUrlPromise = null;

    function buildQuery() {
        if (mediaType === "tv" && (season == null || episode == null)) return null;
        return { isTv: mediaType === "tv" };
    }

    function merge(base, extra) {
        var out = {};
        var key;
        for (key in base) {
            if (Object.prototype.hasOwnProperty.call(base, key)) out[key] = base[key];
        }
        for (key in extra) {
            if (Object.prototype.hasOwnProperty.call(extra, key)) out[key] = extra[key];
        }
        return out;
    }

    function flatten(lists) {
        var out = [];
        for (var i = 0; i < lists.length; i++) {
            for (var j = 0; j < lists[i].length; j++) out.push(lists[i][j]);
        }
        return out;
    }

    function decodeBase64(value) {
        var padded = String(value).replace(/\s/g, "");
        var remainder = padded.length % 4;
        while (remainder > 0 && remainder < 4) {
            padded += "=";
            remainder += 1;
        }
        if (!/^[A-Za-z0-9+\/]*={0,2}$/.test(padded)) throw new Error("invalid base64");
        var text = "";
        for (var i = 0; i < padded.length; i += 4) {
            var n0 = BASE64_ALPHABET.indexOf(padded.charAt(i));
            var n1 = BASE64_ALPHABET.indexOf(padded.charAt(i + 1));
            var n2 = padded.charAt(i + 2) === "=" ? -1 : BASE64_ALPHABET.indexOf(padded.charAt(i + 2));
            var n3 = padded.charAt(i + 3) === "=" ? -1 : BASE64_ALPHABET.indexOf(padded.charAt(i + 3));
            text += String.fromCharCode((n0 << 2) | (n1 >> 4));
            if (n2 !== -1) text += String.fromCharCode(((n1 & 15) << 4) | (n2 >> 2));
            if (n3 !== -1) text += String.fromCharCode(((n2 & 3) << 6) | n3);
        }
        return text;
    }

    function meetsQualityFilter(quality) {
        if (quality === "Auto") return true;
        var num = parseInt(quality, 10);
        return !isNaN(num) && num >= 720;
    }

    function buildNewTvHeaders(ott) {
        return merge(NEW_TV_BASE_HEADERS, { Ott: ott });
    }

    function buildNewTvPlayerHeaders(ott) {
        return merge(NEW_TV_BASE_HEADERS, { Ott: ott, Usertoken: "" });
    }

    function checkDomain(encoded) {
        var base = decodeBase64(encoded).replace(/\/$/, "");
        return fetch(base + "/checknewtv.php", {
            headers: merge(NEW_TV_BASE_HEADERS, { "User-Agent": USER_AGENT })
        }).then(function (response) {
            return response.json();
        }).then(function (data) {
            if (data && data.token_hash) return decodeBase64(data.token_hash).replace(/\/$/, "");
            return null;
        }).then(null, function () {
            return null;
        });
    }

    function resolveApiUrl() {
        if (!apiUrlPromise) {
            apiUrlPromise = Promise.all(NEW_TV_DOMAINS.map(checkDomain)).then(function (found) {
                for (var i = 0; i < found.length; i++) {
                    if (found[i] !== null) return found[i];
                }
                return null;
            });
        }
        return apiUrlPromise;
    }

    function fetchJson(url, headers) {
        return fetch(url, { headers: headers }).then(function (response) {
            return response.ok ? response.json() : null;
        }).then(null, function () {
            return null;
        });
    }

    function fetchFromNetflixDirect() {
        var url = mediaType === "tv"
            ? BASE_URL + "/api/embed-tmdb/" + tmdbId + "?type=tv&s=" + season + "&e=" + episode
            : BASE_URL + "/api/embed-tmdb/" + tmdbId;

        return fetchJson(url, NET27_HEADERS).then(function (data) {
            if (!data || data.ok !== true) return [];

            var subtitles = (data.captions || []).map(function (c) {
                var subUrl = c.url && c.url.charAt(0) === "/" ? BASE_URL + c.url : c.url;
                return { url: subUrl, language: c.lang || "en", name: c.name || "English", headers: PLAYBACK_HEADERS };
            });

            var streams = [];
            if (data.streams && data.streams.length > 0) {
                for (var i = 0; i < data.streams.length; i++) {
                    var quality = data.streams[i].resolution + "p";
                    if (meetsQualityFilter(quality)) {
                        streams.push({
                            name: PROVIDER + " • " + quality,
                            title: PROVIDER + " • " + quality,
                            url: data.streams[i].url,
                            quality: quality,
                            headers: PLAYBACK_HEADERS,
                            subtitles: subtitles
                        });
                    }
                }
            } else if (data.mp4) {
                streams.push({
                    name: PROVIDER + " • Auto",
                    title: PROVIDER + " • Auto",
                    url: data.mp4,
                    quality: "Auto",
                    headers: PLAYBACK_HEADERS,
                    subtitles: subtitles
                });
            }
            return streams;
        });
    }

    function toEpisode(ep, seasonNumber) {
        var epNum = ep.ep ? parseInt(ep.ep) : ep.epNum ? parseInt(ep.epNum.replace("E", "")) : null;
        var sNum = seasonNumber || (ep.sNum ? parseInt(ep.sNum.replace("S", "")) : null);
        return { id: ep.id, s: sNum, ep: epNum };
    }

    function fetchEpisodesPage(seasonId, page, seasonNumber, ott, apiBase) {
        return fetchJson(apiBase + "/newtv/episodes.php?id=" + seasonId + "&page=" + page, buildNewTvHeaders(ott)).then(function (data) {
            if (!data || !data.episodes) return [];
            var episodes = [];
            for (var i = 0; i < data.episodes.length; i++) {
                if (data.episodes[i]) episodes.push(toEpisode(data.episodes[i], seasonNumber));
            }
            if (data.nextPageShow !== 1) return episodes;
            return fetchEpisodesPage(seasonId, page + 1, seasonNumber, ott, apiBase).then(function (more) {
                return episodes.concat(more);
            });
        });
    }

    function getAllEpisodes(postData, ott, apiBase) {
        var episodes = [];
        var seasons = postData.season;
        var selectedSeasonIdx = -1;
        var i;
        if (seasons) {
            for (i = 0; i < seasons.length; i++) {
                if (seasons[i].selected === true) {
                    selectedSeasonIdx = i;
                    break;
                }
            }
        }
        var selectedSeasonId = selectedSeasonIdx >= 0 ? seasons[selectedSeasonIdx].id : postData.nextPageSeason;
        var selectedSeasonNumber = selectedSeasonIdx >= 0 ? selectedSeasonIdx + 1 : null;

        if (postData.episodes) {
            for (i = 0; i < postData.episodes.length; i++) {
                if (postData.episodes[i]) episodes.push(toEpisode(postData.episodes[i], selectedSeasonNumber));
            }
        }

        var extraPageFetches = [];
        if (postData.nextPageShow === 1 && selectedSeasonId) {
            extraPageFetches.push(fetchEpisodesPage(selectedSeasonId, 2, selectedSeasonNumber, ott, apiBase));
        }
        if (seasons) {
            for (i = 0; i < seasons.length; i++) {
                if (seasons[i].id && seasons[i].id !== selectedSeasonId) {
                    extraPageFetches.push(fetchEpisodesPage(seasons[i].id, 1, i + 1, ott, apiBase));
                }
            }
        }

        return Promise.all(extraPageFetches).then(function (extra) {
            return episodes.concat(flatten(extra));
        });
    }

    function resolveTargetId(postData, contentId, ott, apiBase) {
        if (mediaType === "tv") {
            return getAllEpisodes(postData, ott, apiBase).then(function (episodes) {
                for (var i = 0; i < episodes.length; i++) {
                    if (episodes[i] && episodes[i].s === season && episodes[i].ep === episode) {
                        return { id: episodes[i].id };
                    }
                }
                return null;
            });
        }
        var isSeries = postData.type === "t" ||
            (postData.episodes && postData.episodes.filter(function (e) {
                return e !== null;
            }).length > 0);
        if (isSeries) return Promise.resolve(null);
        return Promise.resolve({ id: postData.main_id || contentId });
    }

    function fetchFromPlatform(platformKey, title) {
        var ott = PLATFORM_MAP[platformKey].ott;
        return resolveApiUrl().then(function (apiBase) {
            if (!apiBase) return [];
            return fetchJson(apiBase + "/newtv/search.php?s=" + encodeURIComponent(title), buildNewTvHeaders(ott)).then(function (searchData) {
                if (!searchData || !searchData.searchResult || searchData.searchResult.length === 0) return [];
                var contentId = searchData.searchResult[0].id;
                return fetchJson(
                    apiBase + "/newtv/post.php?id=" + contentId,
                    merge(buildNewTvPlayerHeaders(ott), { Lastep: "" })
                ).then(function (postData) {
                    if (!postData) return [];
                    return resolveTargetId(postData, contentId, ott, apiBase).then(function (target) {
                        if (!target) return [];
                        return fetchJson(apiBase + "/newtv/player.php?id=" + target.id, buildNewTvPlayerHeaders(ott)).then(function (response) {
                            if (!response || response.status !== "ok" || !response.video_link) return [];
                            var label = platformKey.charAt(0).toUpperCase() + platformKey.slice(1);
                            return [{
                                name: PROVIDER + " • " + label,
                                title: PROVIDER + " • " + label,
                                url: response.video_link,
                                quality: "Auto",
                                headers: { Referer: response.referer || apiBase }
                            }];
                        });
                    });
                });
            });
        }).then(null, function () {
            return [];
        });
    }

    var query = buildQuery();
    if (!query) return Promise.resolve([]);

    return fetchJson(
        TMDB_API + "/" + (query.isTv ? "tv" : "movie") + "/" + tmdbId + "?api_key=" + TMDB_KEY,
        { "User-Agent": USER_AGENT, "Accept": "application/json" }
    ).then(function (tmdbData) {
        if (!tmdbData) return [];
        var title = query.isTv ? tmdbData.name : tmdbData.title;
        if (!title) return [];

        return Promise.all([
            fetchFromNetflixDirect(),
            fetchFromPlatform("primevideo", title),
            fetchFromPlatform("hotstar", title),
            fetchFromPlatform("disney", title)
        ]).then(function (replies) {
            var direct = replies[0] && replies[0].length > 0
                ? Promise.resolve(replies[0])
                : fetchFromPlatform("netflix", title);
            return direct.then(function (first) {
                var streams = first.slice();
                for (var i = 1; i < replies.length; i++) {
                    if (replies[i] && replies[i].length > 0) streams = streams.concat(replies[i]);
                }
                var seen = Object.create(null);
                return streams.filter(function (s) {
                    if (!s.url || !meetsQualityFilter(s.quality) || seen[s.url] === true) return false;
                    seen[s.url] = true;
                    return true;
                });
            });
        });
    }).then(null, function () {
        return [];
    });
}

module.exports = { getStreams: getStreams };