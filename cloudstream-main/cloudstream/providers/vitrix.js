function getStreams(tmdbId, mediaType, season, episode) {
    var BASE_URL = "https://anilight.live";
    var API_BASE = "https://api.anilight.live/api";
    var TMDB_API = "https://api.themoviedb.org/3";
    var TMDB_KEY = (typeof TMDB_API_KEY !== "undefined" && TMDB_API_KEY) || "307b7b8ef035c6aa336900aef4e203bd";
    var USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36";
    var SUB_LANGS = {
        ar: "Arabic", baq: "Basque", cat: "Catalan", cze: "Czech", dan: "Danish", de: "German",
        dut: "Dutch", en: "English", es: "Spanish", fil: "Filipino", fin: "Finnish", fr: "French",
        glg: "Galician", gre: "Greek", heb: "Hebrew", hrv: "Croatian", hun: "Hungarian",
        id: "Indonesian", it: "Italian", ja: "Japanese", ko: "Korean", may: "Malay",
        nob: "Norwegian", pol: "Polish", pt: "Portuguese", ro: "Romanian", ru: "Russian",
        rum: "Romanian", swe: "Swedish", th: "Thai", tur: "Turkish", ukr: "Ukrainian",
        vi: "Vietnamese", zh: "Chinese"
    };

    var cachedSessionToken = null;

    function buildQuery() {
        var isTv = mediaType === "tv";
        if (!/^\d+$/.test(String(tmdbId))) return null;
        if (!isTv && mediaType !== "movie") return null;
        if (isTv && (season == null || episode == null)) return null;
        return { isTv: isTv };
    }

    function stableSort(items, compare) {
        return items
            .map(function (item, index) { return { item: item, index: index }; })
            .sort(function (a, b) { return compare(a.item, b.item) || a.index - b.index; })
            .map(function (entry) { return entry.item; });
    }

    function buildHeaders(extraHeaders) {
        var headers = {
            "User-Agent": USER_AGENT,
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": BASE_URL + "/"
        };
        var extra = extraHeaders || {};
        Object.keys(extra).forEach(function (key) { headers[key] = extra[key]; });
        return headers;
    }

    function playHeaders() {
        return { "User-Agent": USER_AGENT, "Referer": BASE_URL + "/" };
    }

    function safeFetch(url, options) {
        return Promise.resolve()
            .then(function () { return fetch(url, options); })
            .then(function (response) { return response.status !== 0 ? response : null; })
            .then(null, function () { return null; });
    }

    function readJson(response) {
        if (!response || !response.ok) return Promise.resolve(null);
        return Promise.resolve()
            .then(function () { return response.json(); })
            .then(null, function () { return null; });
    }

    function fetchJson(url, headers) {
        return safeFetch(url, { headers: headers || buildHeaders() }).then(readJson);
    }

    function ensureSession(forceRefresh) {
        if (!forceRefresh && cachedSessionToken) return Promise.resolve(cachedSessionToken);

        return safeFetch(API_BASE + "/sources/verify", {
            method: "POST",
            headers: buildHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({ token: "direct" })
        }).then(readJson).then(function (payload) {
            if (payload && typeof payload.sessionToken === "string" && payload.sessionToken) {
                cachedSessionToken = payload.sessionToken;
            }
            return cachedSessionToken;
        });
    }

    function searchTitles(query) {
        return fetchJson(API_BASE + "/search?q=" + encodeURIComponent(query) + "&hideAdult=true").then(function (results) {
            return Array.isArray(results) ? results.filter(function (media) { return media && media.isAdult !== true; }) : [];
        });
    }

    function requestSources(url, forceRefresh) {
        return ensureSession(forceRefresh).then(function (sessionToken) {
            if (!sessionToken) return { done: true, value: null };
            return safeFetch(url, { headers: buildHeaders({ "x-source-session": sessionToken }) }).then(function (response) {
                if (response && response.status !== 401 && response.status !== 403) {
                    return readJson(response).then(function (value) { return { done: true, value: value }; });
                }
                return { done: false, value: null };
            });
        });
    }

    function fetchSources(animeId, episode, language, useBackup) {
        var url = API_BASE + "/sources?id=" + animeId + "&episode=" + episode + "&language=" + language + (useBackup ? "&backup=true" : "");

        return requestSources(url, false).then(function (first) {
            if (first.done) return first.value;
            return requestSources(url, true).then(function (second) {
                return second.done ? second.value : null;
            });
        });
    }

    function extractTokens(entry) {
        return [].concat((entry && entry.url) || []).filter(function (token) {
            return typeof token === "string" && token.trim();
        });
    }

    function resolveStreamUrl(token) {
        var balancerUrl = API_BASE + "/lb/e/" + token;
        return safeFetch(balancerUrl, { headers: buildHeaders(), redirect: "manual" }).then(function (response) {
            if (!response) return null;

            var location = (response.headers.get("location") || "").trim();
            if (/^https?:\/\//i.test(location)) return location;
            if (response.status >= 300 && response.status < 400) return balancerUrl;
            if (response.ok) return (response.url && response.url !== balancerUrl) ? response.url : balancerUrl;
            return null;
        });
    }

    function probeHlsPlaylist(url) {
        return safeFetch(url, { headers: buildHeaders() }).then(function (response) {
            if (!response || !response.ok) return null;

            return Promise.resolve()
                .then(function () { return response.text(); })
                .then(function (playlist) {
                    if (!playlist || playlist.replace(/^\uFEFF/, "").indexOf("#EXTM3U") !== 0) return null;

                    var heights = [0];
                    var pattern = /RESOLUTION=\d+x(\d+)/g;
                    var match;
                    while ((match = pattern.exec(playlist))) heights.push(parseInt(match[1], 10));
                    return { url: url, height: Math.max.apply(null, heights) || null };
                }, function () { return null; });
        });
    }

    function formatLanguageLabel(rawLabel) {
        var label = String(rawLabel || "").trim();
        if (/[\sA-Z]/.test(label)) return label;

        var parts = label.split("-");
        var code = parts[0];
        var variantParts = parts.slice(1);
        var languageName = SUB_LANGS[code.toLowerCase()];
        if (!languageName || !variantParts.length) return languageName || label;

        var variant = { signs: "Signs", sdh: "SDH" }[variantParts[0]] || variantParts.join("-");
        return languageName + " (" + variant + ")";
    }

    function collectSubtitleTracks(tracks) {
        var seenLabels = Object.create(null);
        var subtitles = [];

        tracks.forEach(function (track) {
            if (!track || (track.kind && track.kind !== "captions")) return;

            var token = typeof track.url === "string" ? track.url.trim() : "";
            var rawLabel = (track.label && String(track.label).trim()) || (track.lang && String(track.lang).trim());
            if (!token || !rawLabel) return;

            var label = formatLanguageLabel(rawLabel);
            if (seenLabels[label.toLowerCase()]) return;
            seenLabels[label.toLowerCase()] = true;

            subtitles.push({
                url: API_BASE + "/proxy/captions?token=" + encodeURIComponent(token),
                language: label,
                name: label
            });
        });
        return subtitles;
    }

    function normalizeTitle(title) {
        return String(title || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    }

    function getTitleVariants(media) {
        var title = media.title || {};
        return [title.english, title.romaji, title.userPreferred, title.native].filter(Boolean);
    }

    function getNormalizedTitles(media) {
        return getTitleVariants(media).map(function (title) { return normalizeTitle(title); }).filter(Boolean);
    }

    function parseSeasonNumber(title) {
        var text = String(title || "").toLowerCase();
        var match = text.match(/season\s*(\d+)/) || text.match(/(\d+)(?:st|nd|rd|th)\s*season/);
        if (match) return parseInt(match[1], 10);

        match = text.match(/\b(ii|iii|iv|v)\b\s*$/);
        return match ? { ii: 2, iii: 3, iv: 4, v: 5 }[match[1]] : null;
    }

    function findSeasonNumber(media) {
        var variants = getTitleVariants(media);
        for (var i = 0; i < variants.length; i++) {
            var found = parseSeasonNumber(variants[i]);
            if (found != null) return found;
        }
        return null;
    }

    function scoreMatch(media, target) {
        var targetNames = target.names.map(function (name) { return normalizeTitle(name); }).filter(Boolean);

        var score = 0;
        getNormalizedTitles(media).forEach(function (title) {
            targetNames.forEach(function (name) {
                if (title === name) score = Math.max(score, 10);
                else if (title.indexOf(name) === 0 || name.indexOf(title) === 0) score = Math.max(score, 6);
                else if (title.indexOf(name) !== -1 || name.indexOf(title) !== -1) score = Math.max(score, 4);
            });
        });
        if (score === 0) return 0;

        if (target.year && media.seasonYear) {
            var yearDelta = Math.abs(media.seasonYear - target.year);
            score += yearDelta === 0 ? 5 : yearDelta === 1 ? 2 : -3;
        }

        if (target.mediaType === "movie") {
            score += media.format === "MOVIE" ? 4 : -4;
        } else if (media.format === "MOVIE") {
            score -= 3;
        }

        if (target.mediaType === "tv") {
            var candidateSeason = findSeasonNumber(media);
            if (target.season > 1) {
                if (candidateSeason === target.season) score += 6;
                else if (candidateSeason != null) score -= 4;
            } else if (candidateSeason != null && candidateSeason > 1) {
                score -= 4;
            }
        }
        return score;
    }

    function fetchTmdbMetadata(tmdbId, mediaType, season) {
        var isTv = mediaType === "tv";
        var query = "?api_key=" + TMDB_KEY + "&language=en-US";
        var headers = { "User-Agent": USER_AGENT };

        return Promise.all([
            fetchJson(TMDB_API + "/" + (isTv ? "tv" : "movie") + "/" + tmdbId + query, headers),
            isTv && season != null ? fetchJson(TMDB_API + "/tv/" + tmdbId + "/season/" + season + query, headers) : null
        ]).then(function (replies) {
            var details = replies[0];
            var seasonDetails = replies[1];
            if (!details) return null;

            var dateString = isTv
                ? ((seasonDetails && seasonDetails.air_date) || details.first_air_date || "")
                : (details.release_date || "");
            var names = [];
            (isTv
                ? [details.name, details.original_name]
                : [details.title, details.original_title]).filter(Boolean).forEach(function (name) {
                    if (names.indexOf(name) === -1) names.push(name);
                });

            var episodes = (seasonDetails && Array.isArray(seasonDetails.episodes)) ? seasonDetails.episodes : [];
            var episodeAirTimes = {};
            episodes.forEach(function (episode) {
                var airTime = Date.parse(episode && episode.air_date);
                if (!isNaN(airTime)) episodeAirTimes[episode.episode_number] = airTime;
            });
            var airTimes = Object.keys(episodeAirTimes).map(function (key) { return episodeAirTimes[key]; });

            return {
                names: names,
                year: parseInt(String(dateString).slice(0, 4), 10) || null,
                seasonName: seasonDetails && seasonDetails.name ? seasonDetails.name : null,
                episodeCount: episodes.length || null,
                windowStart: airTimes.length ? Math.min.apply(null, airTimes) : null,
                windowEnd: airTimes.length ? Math.max.apply(null, airTimes) : null,
                episodeAirTimes: episodeAirTimes
            };
        });
    }

    function findMatches(metadata, mediaType, season, episode) {
        var queries = metadata.names.slice();
        function addQuery(value) {
            if (queries.indexOf(value) === -1) queries.push(value);
        }

        if (mediaType === "tv" && season > 1) {
            metadata.names.forEach(function (name) { addQuery(name + " Season " + season); });
            if (metadata.seasonName && !/^season\s*\d+$/i.test(metadata.seasonName)) {
                addQuery(metadata.names[0] + " " + metadata.seasonName);
                addQuery(metadata.seasonName);
            }
        }

        if (mediaType === "tv" && ((metadata.episodeCount && metadata.episodeCount > 14) || (episode && episode > 14))) {
            ["Part 2", "Part 3", "2nd Cour", "Cour 2", "Season 2"].forEach(function (suffix) {
                addQuery(metadata.names[0] + " " + suffix);
            });
        }

        return Promise.all(queries.slice(0, 9).map(function (query) { return searchTitles(query); })).then(function (searchResults) {
            var ids = [];
            var allMedia = [];
            [].concat.apply([], searchResults).forEach(function (media) {
                if (!media || media.id == null) return;
                var index = ids.indexOf(media.id);
                if (index === -1) {
                    ids.push(media.id);
                    allMedia.push(media);
                } else {
                    allMedia[index] = media;
                }
            });

            var target = {
                names: metadata.names.concat(metadata.seasonName || []),
                year: metadata.year,
                mediaType: mediaType,
                season: season || 1
            };
            var scored = allMedia
                .map(function (media) { return { media: media, score: scoreMatch(media, target) }; })
                .filter(function (candidate) { return candidate.score >= 10; });
            var ranked = stableSort(scored, function (a, b) { return b.score - a.score; });

            return { ranked: ranked, all: allMedia };
        });
    }

    function getStartTimestamp(media) {
        var date = media.startDate;
        return date && date.year ? Date.UTC(date.year, (date.month || 1) - 1, date.day || 1) : null;
    }

    function buildCourGroup(allMedia, topMatch, metadata, season) {
        var targetNames = metadata.names.map(function (name) { return normalizeTitle(name); }).filter(Boolean);

        var group = allMedia.filter(function (media) {
            if (media.format === "MOVIE") return false;
            if (media.id === topMatch.id) return true;

            var startsWithTarget = getNormalizedTitles(media).some(function (title) {
                return targetNames.some(function (name) { return title.indexOf(name) === 0 || name.indexOf(title) === 0; });
            });
            if (!startsWithTarget) return false;

            var candidateSeason = findSeasonNumber(media);
            if (season > 1 ? (candidateSeason != null && candidateSeason !== season) : (candidateSeason != null && candidateSeason > 1)) {
                return false;
            }

            var startTimestamp = getStartTimestamp(media);
            if (startTimestamp == null) return false;

            if (metadata.windowStart != null) {
                return startTimestamp >= metadata.windowStart - 60 * 86400000
                    && startTimestamp <= metadata.windowEnd + 60 * 86400000;
            }
            return metadata.year ? Math.abs(new Date(startTimestamp).getUTCFullYear() - metadata.year) <= 1 : false;
        });

        return stableSort(group, function (a, b) { return (getStartTimestamp(a) || 0) - (getStartTimestamp(b) || 0); });
    }

    function mapEpisodeToCour(courGroup, metadata, episode) {
        if (courGroup.length < 2) return null;

        var episodeOffset = 0;
        for (var index = 0; index < courGroup.length; index++) {
            var courEpisodeCount = courGroup[index].episodes;
            var isLast = index === courGroup.length - 1;

            if (courEpisodeCount == null && !isLast) break;
            if (isLast || episode <= episodeOffset + courEpisodeCount) {
                if (episode > episodeOffset) return { id: courGroup[index].id, episode: episode - episodeOffset };
                break;
            }
            episodeOffset += courEpisodeCount;
        }

        var airTime = metadata.episodeAirTimes[episode];
        if (airTime == null) return null;

        var matchedCour = null;
        courGroup.forEach(function (media) {
            var startTimestamp = getStartTimestamp(media);
            if (startTimestamp != null && startTimestamp <= airTime + 30 * 86400000) matchedCour = media;
        });
        if (!matchedCour) return null;

        var episodesBefore = 0;
        for (var position = 0; courGroup[position].id !== matchedCour.id; position++) {
            episodesBefore += courGroup[position].episodes || 0;
        }
        return episode > episodesBefore ? { id: matchedCour.id, episode: episode - episodesBefore } : null;
    }

    function parseHeight(qualityLabel) {
        var height = parseInt(String(qualityLabel || "").replace(/\D/g, ""), 10);
        return height >= 100 && height <= 4320 ? height : null;
    }

    function listOf(value, allowString) {
        var list = value || [];
        if (Array.isArray(list)) return list;
        if (allowString && typeof list === "string") return [];
        throw new Error("list");
    }

    function resolvePrimary(entry) {
        var token = extractTokens(entry)[0];
        if (!token) return Promise.resolve(null);
        return resolveStreamUrl(token).then(function (url) {
            return url ? { url: url, height: parseHeight(entry.quality) } : null;
        });
    }

    function resolveBackup(entry) {
        return Promise.all(extractTokens(entry).map(function (token) {
            return resolveStreamUrl(token).then(function (url) {
                return url && probeHlsPlaylist(url);
            });
        })).then(function (playlists) {
            for (var i = 0; i < playlists.length; i++) {
                var playlist = playlists[i];
                if (playlist && (!playlist.height || playlist.height === 1080)) return playlist;
            }
            return null;
        });
    }

    function buildStreams(animeId, episode, language) {
        var isDub = language === "dub";
        var audioName = isDub ? "English" : "Japanese";
        var streams = [];
        var seenUrls = Object.create(null);

        function addStream(provider, url, height, isHls) {
            if (seenUrls[url] || (height && height !== 1080)) return;
            seenUrls[url] = true;

            var label = provider + " \u2022 " + audioName;
            var stream = {
                name: label,
                title: label,
                url: url,
                quality: height ? height + "p" : "Auto",
                headers: playHeaders()
            };
            if (isHls) stream.type = "hls";
            streams.push(stream);
        }

        return Promise.all([
            fetchSources(animeId, episode, language, false),
            fetchSources(animeId, episode, language, true)
        ]).then(function (replies) {
            var primary = replies[0];
            var backup = replies[1];
            var primarySources = listOf(primary && primary.sources, false);
            var backupSources = listOf(backup && backup.sources, true);
            var tracks = listOf(primary && primary.tracks, true).concat(listOf(backup && backup.tracks, true));

            return Promise.all([
                Promise.all(primarySources.map(resolvePrimary)),
                Promise.all(backupSources.map(resolveBackup))
            ]).then(function (resolved) {
                resolved[0].forEach(function (stream) {
                    if (stream) addStream("AniLight", stream.url, stream.height, false);
                });

                var backupPlaylist = null;
                for (var i = 0; i < resolved[1].length && !backupPlaylist; i++) backupPlaylist = resolved[1][i];
                if (backupPlaylist) addStream("MegaPlay", backupPlaylist.url, null, true);

                var subtitles = collectSubtitleTracks(tracks);
                if (subtitles.length) streams.forEach(function (stream) { stream.subtitles = subtitles; });
                return streams;
            });
        });
    }

    function buildAttempts(matches, metadata, isTv) {
        var keys = [];
        var attempts = [];

        function addAttempt(animeId, targetEpisode) {
            var key = animeId + ":" + targetEpisode;
            var attempt = { animeId: animeId, episode: targetEpisode };
            var index = keys.indexOf(key);
            if (index === -1) {
                keys.push(key);
                attempts.push(attempt);
            } else {
                attempts[index] = attempt;
            }
        }

        var topMatches = matches.ranked.slice(0, 2).map(function (candidate) { return candidate.media; });
        if (isTv) {
            var courMapping = mapEpisodeToCour(buildCourGroup(matches.all, topMatches[0], metadata, season), metadata, episode);
            if (courMapping) addAttempt(courMapping.id, courMapping.episode);
        }
        topMatches.forEach(function (media) { addAttempt(media.id, isTv ? episode : 1); });
        return attempts;
    }

    function runAttempt(attempt) {
        return Promise.all(["sub", "dub"].map(function (language) {
            return buildStreams(attempt.animeId, attempt.episode, language);
        })).then(function (streamLists) {
            var seenUrls = Object.create(null);
            var uniqueStreams = [].concat.apply([], streamLists).filter(function (stream) {
                if (seenUrls[stream.url]) return false;
                seenUrls[stream.url] = true;
                return true;
            });
            return { failed: false, streams: uniqueStreams };
        }, function () {
            return { failed: true, streams: [] };
        });
    }

    function tryAttempts(attempts, index) {
        if (index >= attempts.length) return Promise.resolve([]);
        return runAttempt(attempts[index]).then(function (result) {
            if (result.failed) return [];
            if (result.streams.length) return result.streams;
            return tryAttempts(attempts, index + 1);
        });
    }

    var query = buildQuery();
    if (!query) return Promise.resolve([]);

    return fetchTmdbMetadata(tmdbId, mediaType, query.isTv ? season : null)
        .then(function (metadata) {
            if (!metadata || !metadata.names.length) return [];

            return findMatches(metadata, mediaType, season, episode).then(function (matches) {
                if (!matches.ranked.length) return [];

                var attempts = buildAttempts(matches, metadata, query.isTv);
                return tryAttempts(attempts, 0);
            });
        })
        .then(null, function () { return []; });
}

module.exports = { getStreams: getStreams };