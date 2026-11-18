function getStreams(tmdbId, mediaType, season, episode) {
    var BASE_URL = "https://flixhub.net";
    var TMDB_API = "https://api.themoviedb.org/3";
    var TMDB_KEY = (typeof TMDB_API_KEY !== "undefined" && TMDB_API_KEY) || "307b7b8ef035c6aa336900aef4e203bd";
    var USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";
    var HEADERS = {
        "User-Agent": USER_AGENT,
        "Referer": BASE_URL + "/",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    };
    var QUALITY_RANK = { '2160p': 5, '1440p': 4, '1080p': 3, '720p': 2, '480p': 0, '360p': -1, 'auto': -2 };
    var MAX_RANK = 5;
    var ENTITIES = Object.create(null);
    ENTITIES.amp = "&";
    ENTITIES.lt = "<";
    ENTITIES.gt = ">";
    ENTITIES.quot = "\"";
    ENTITIES.apos = "'";
    ENTITIES.nbsp = "\u00A0";

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

    function fetchHtml(url) {
        return fetch(url, { headers: HEADERS }).then(function (res) {
            return res.ok ? res.text() : null;
        }).then(null, function () {
            return null;
        });
    }

    function getTmdbMeta(query) {
        var isTv = query.mediaType === "tv";
        var url = TMDB_API + "/" + (isTv ? "tv" : "movie") + "/" + query.tmdbId + "?api_key=" + TMDB_KEY + "&language=en-US";
        return fetch(url, { headers: { Accept: "application/json" } }).then(function (res) {
            return res.ok ? res.json() : null;
        }).then(function (data) {
            if (!data) return null;
            return { title: (isTv ? data.name : data.title) || "" };
        }).then(null, function () {
            return null;
        });
    }

    function toSlug(title) {
        return title.toLowerCase()
            .replace(/'/g, "")
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");
    }

    function qualityOf(url) {
        var s = String(url || "").toLowerCase();
        if (s.indexOf("4k") !== -1 || s.indexOf("2160") !== -1) return "2160p";
        if (s.indexOf("1440") !== -1) return "1440p";
        if (s.indexOf("1080") !== -1) return "1080p";
        if (s.indexOf("720") !== -1) return "720p";
        if (s.indexOf("480") !== -1) return "480p";
        if (s.indexOf("360") !== -1) return "360p";
        return "auto";
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

    function decodeEntities(text) {
        return String(text).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, function (all, body) {
            var low = body.toLowerCase();
            if (low.charAt(0) === "#") {
                var code = low.charAt(1) === "x" ? parseInt(low.slice(2), 16) : parseInt(low.slice(1), 10);
                return code > 0 && code < 65536 ? String.fromCharCode(code) : all;
            }
            var named = ENTITIES[low];
            return named === undefined ? all : named;
        });
    }

    function isSpace(ch) {
        return ch === " " || ch === "\t" || ch === "\r" || ch === "\n" || ch === "\f";
    }

    function readAttributes(html, from) {
        var attrs = Object.create(null);
        var n = html.length;
        var j = from;
        while (j < n) {
            var ch = html.charAt(j);
            if (ch === ">") {
                j++;
                break;
            }
            if (ch === "/" || isSpace(ch)) {
                j++;
                continue;
            }
            var k = j;
            while (k < n && "\u003D> \t\r\n\f/".indexOf(html.charAt(k)) === -1) k++;
            var key = html.slice(j, k).toLowerCase();
            j = k;
            while (j < n && isSpace(html.charAt(j))) j++;
            var value = "";
            if (html.charAt(j) === "=") {
                j++;
                while (j < n && isSpace(html.charAt(j))) j++;
                var quote = html.charAt(j);
                if (quote === "\"" || quote === "'") {
                    var close = html.indexOf(quote, j + 1);
                    if (close < 0) close = n;
                    value = html.slice(j + 1, close);
                    j = close + 1;
                } else {
                    k = j;
                    while (k < n && " \t\r\n\f>".indexOf(html.charAt(k)) === -1) k++;
                    value = html.slice(j, k);
                    j = k;
                }
            }
            if (key && attrs[key] === undefined) attrs[key] = decodeEntities(value);
        }
        return { attrs: attrs, end: j };
    }

    function scanTags(html, lower) {
        var tags = [];
        var n = html.length;
        var i = 0;
        while (i < n) {
            var lt = html.indexOf("<", i);
            if (lt < 0) break;
            if (html.substr(lt, 4) === "<!--") {
                var commentEnd = html.indexOf("-->", lt + 4);
                i = commentEnd < 0 ? n : commentEnd + 3;
                continue;
            }
            if (!/[a-zA-Z]/.test(html.charAt(lt + 1))) {
                i = lt + 1;
                continue;
            }
            var j = lt + 1;
            while (j < n && !isSpace(html.charAt(j)) && html.charAt(j) !== "/" && html.charAt(j) !== ">") j++;
            var name = lower.slice(lt + 1, j);
            var read = readAttributes(html, j);
            tags.push({ name: name, attrs: read.attrs, start: lt, end: read.end });
            i = read.end;
            if (name === "script" || name === "style" || name === "textarea" || name === "title") {
                var rawEnd = lower.indexOf("</" + name, i);
                i = rawEnd < 0 ? n : rawEnd;
            }
        }
        return tags;
    }

    function hasClass(tag, className) {
        var list = String(tag.attrs["class"] || "").split(/\s+/);
        return list.indexOf(className) !== -1;
    }

    function closeOf(lower, name, from) {
        var open = "<" + name;
        var close = "</" + name;
        var depth = 1;
        var pos = from;
        while (depth > 0) {
            var c = lower.indexOf(close, pos);
            if (c < 0) return -1;
            var o = lower.indexOf(open, pos);
            while (o >= 0 && o < c && !/[\s\/>]/.test(lower.charAt(o + open.length))) {
                o = lower.indexOf(open, o + 1);
            }
            if (o >= 0 && o < c) {
                depth++;
                pos = o + open.length;
            } else {
                depth--;
                pos = c + close.length;
                if (depth === 0) return c;
            }
        }
        return -1;
    }

    function innerText(html, lower, tag) {
        var end = closeOf(lower, tag.name, tag.end);
        if (end < 0) end = html.length;
        return decodeEntities(html.slice(tag.end, end).replace(/<[^>]*>/g, ""));
    }

    function parseHtml(html) {
        var lower = html.toLowerCase();
        return { html: html, lower: lower, tags: scanTags(html, lower) };
    }

    function resolveWatchPage(slug) {
        var segment = mediaType === "tv" ? "series" : "movie";
        var urls = [BASE_URL + "/watch/" + segment + "/" + slug, BASE_URL + "/watch/" + segment + "/" + slug + "-1"];
        return Promise.all(urls.map(fetchHtml)).then(function (pages) {
            for (var i = 0; i < pages.length; i++) {
                if (pages[i] && pages[i].indexOf("theaterPlayer") !== -1) return pages[i];
            }
            return null;
        });
    }

    function extractStreamUrls(html) {
        var tags = parseHtml(html).tags;
        var visited = Object.create(null);
        var results = [];
        var i;

        function collect(rawUrl) {
            var url = (rawUrl || "").trim();
            if (url && url.indexOf("http") === 0 && !visited[url]) {
                visited[url] = true;
                results.push(url);
            }
        }

        for (i = 0; i < tags.length; i++) {
            if (tags[i].attrs.id === "theaterPlayer") {
                collect(tags[i].attrs["data-stream-url"]);
                break;
            }
        }
        for (i = 0; i < tags.length; i++) {
            if (tags[i].attrs["data-download-url"] !== undefined) {
                collect(tags[i].attrs["data-download-url"]);
                break;
            }
        }
        for (i = 0; i < tags.length; i++) {
            if (tags[i].name === "source" && tags[i].attrs.src !== undefined) collect(tags[i].attrs.src);
        }
        for (i = 0; i < tags.length; i++) {
            var href = tags[i].attrs.href;
            if (tags[i].name === "a" && href !== undefined && href.indexOf("/stream/") !== -1) {
                collect(href.indexOf("http") === 0 ? href : BASE_URL + href);
            }
        }

        var pattern = /https?:\/\/[^\s"'<>\\]+\.(?:mp4|mkv|m3u8|webm|m4v)(?:\?[^\s"'<>\\]*)?/gi;
        var m;
        while ((m = pattern.exec(html)) !== null) collect(m[0]);

        return results;
    }

    function episodeSlug(href) {
        var parts = href.split("/episode/");
        return parts.length < 2 ? "" : parts[1].split("?")[0].split("#")[0];
    }

    function absolute(href) {
        return href.indexOf("http") === 0 ? href : BASE_URL + href;
    }

    function isEpisodeLink(tag) {
        if (tag.name !== "a") return false;
        var href = tag.attrs.href;
        return hasClass(tag, "player-sidebar-card-link") || (href !== undefined && href.indexOf("/watch/episode/") !== -1);
    }

    function cardEpisodes(page) {
        var episodes = [];
        var visited = Object.create(null);
        var tags = page.tags;
        for (var i = 0; i < tags.length; i++) {
            var card = tags[i];
            if (card.name !== "article" || !hasClass(card, "player-sidebar-card")) continue;
            if (card.attrs["data-season-number"] === undefined) continue;
            var seasonNumber = parseInt(card.attrs["data-season-number"], 10);
            if (!seasonNumber) continue;

            var regionEnd = closeOf(page.lower, "article", card.end);
            if (regionEnd < 0) regionEnd = page.html.length;

            var anchor = null;
            var titleText = "";
            for (var j = 0; j < tags.length; j++) {
                var t = tags[j];
                if (t.start < card.end || t.start >= regionEnd) continue;
                if (!anchor && isEpisodeLink(t)) anchor = t;
                if (hasClass(t, "player-sidebar-card-title")) titleText += innerText(page.html, page.lower, t);
            }
            var href = anchor ? anchor.attrs.href || "" : "";
            if (!href) continue;

            var slug = episodeSlug(href);
            if (!slug || visited[slug]) continue;
            visited[slug] = true;

            var match = titleText.trim().match(/^E(\d+)/i) || titleText.trim().match(/(\d+)/);
            var count = 0;
            for (var e = 0; e < episodes.length; e++) {
                if (episodes[e].season === seasonNumber) count++;
            }
            episodes.push({
                season: seasonNumber,
                episode: match ? parseInt(match[1], 10) : count + 1,
                watchUrl: absolute(href)
            });
        }
        return episodes;
    }

    function linkEpisodes(page) {
        var episodes = [];
        var visited = Object.create(null);
        var index = 0;
        for (var i = 0; i < page.tags.length; i++) {
            var tag = page.tags[i];
            var href = tag.attrs.href;
            if (tag.name !== "a" || href === undefined || href.indexOf("/watch/episode/") === -1) continue;
            var position = index++;
            var slug = episodeSlug(href);
            if (!slug || visited[slug]) continue;
            visited[slug] = true;
            var match = innerText(page.html, page.lower, tag).match(/(\d+)/);
            episodes.push({
                season: 1,
                episode: match ? parseInt(match[1], 10) : position + 1,
                watchUrl: absolute(href)
            });
        }
        return episodes;
    }

    function parseEpisodeList(html) {
        var page = parseHtml(html);
        var episodes = cardEpisodes(page);
        return episodes.length ? episodes : linkEpisodes(page);
    }

    function buildStreamEntries(urls) {
        var seen = Object.create(null);
        var entries = [];
        for (var i = 0; i < urls.length && entries.length < 2; i++) {
            var url = urls[i];
            if (!url || seen[url]) continue;
            seen[url] = true;
            var quality = qualityOf(url);
            var rank = QUALITY_RANK[quality];
            var tag = sortTag(rank === undefined ? -2 : rank);
            entries.push({
                name: tag + "FlixHub FTP",
                title: tag + "FlixHub FTP \u2022 " + quality,
                url: url,
                quality: quality,
                headers: { "User-Agent": USER_AGENT, "Referer": BASE_URL + "/" }
            });
        }
        return entries;
    }

    function episodeStreams(html, query) {
        var episodes = parseEpisodeList(html);
        var target = null;
        for (var i = 0; i < episodes.length; i++) {
            if (episodes[i].season === query.season && episodes[i].episode === query.episode) {
                target = episodes[i];
                break;
            }
        }
        if (!target) return [];
        return fetchHtml(target.watchUrl).then(function (episodeHtml) {
            return episodeHtml ? buildStreamEntries(extractStreamUrls(episodeHtml)) : [];
        });
    }

    function run() {
        var query = buildQuery();
        if (!query) return [];
        return getTmdbMeta(query).then(function (meta) {
            var slug = meta && meta.title ? toSlug(meta.title) : "";
            if (!slug) return [];
            return resolveWatchPage(slug).then(function (html) {
                if (!html) return [];
                if (query.mediaType === "movie") return buildStreamEntries(extractStreamUrls(html));
                return episodeStreams(html, query);
            });
        });
    }

    return Promise.resolve().then(run).then(null, function () {
        return [];
    });
}

module.exports = { getStreams: getStreams };
