function getStreams(tmdbId, mediaType, season, episode) {
    var BASE_URL = 'http://new.circleftp.net';
    var BASE_URL_P = 'http://new.circleftp.net:5000';
    var TMDB_API = 'https://api.themoviedb.org/3';
    var TMDB_KEY = (typeof TMDB_API_KEY !== 'undefined' && TMDB_API_KEY) || '307b7b8ef035c6aa336900aef4e203bd';
    var FLBCK_URL = 'http://15.1.1.50:5000';
    var USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
    var HEADERS = {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': BASE_URL + '/'
    };
    var QUALITY_RANK = { '2160p': 5, '1440p': 4, '1080p': 3, '720p': 2, '576p': 1, '480p': 0, 'Unknown': -1 };
    var MAX_RANK = 5;

    function buildQuery() {
        if (!/^\d+$/.test(String(tmdbId))) return null;
        if (mediaType !== 'movie' && mediaType !== 'tv') return null;
        if (!TMDB_KEY) return null;
        if (mediaType === 'movie') {
            return { tmdbId: tmdbId, mediaType: 'movie', season: null, episode: null };
        }
        if (season == null || episode == null) return null;
        return { tmdbId: tmdbId, mediaType: 'tv', season: Number(season), episode: Number(episode) };
    }

    function fetchText(url, headers) {
        return fetch(url, { headers: headers || HEADERS }).then(function (res) {
            return res.ok ? res.text() : null;
        }).then(null, function () {
            return null;
        });
    }

    function fetchJson(url, headers) {
        return fetch(url, { headers: headers || HEADERS }).then(function (res) {
            return res.ok ? res.json() : null;
        }).then(null, function () {
            return null;
        });
    }

    function parseJson(text) {
        try {
            return JSON.parse(text);
        } catch (e) {
            return null;
        }
    }

    function circleGet(path) {
        var p = path.charAt(0) === '/' ? path : '/' + path;
        return fetchText(BASE_URL_P + p).then(function (text) {
            if (text !== null && text !== undefined) return text;
            return fetchText(FLBCK_URL + p);
        });
    }

    function normalize(title) {
        return String(title || '')
            .replace(/\b(1080p|720p|480p|2160p|4k|web[- ]?dl|webrip|bluray|hdrip|x264|x265|hevc|10bit|dual[- ]?audio|hindi[- ]?dubbed|dubbed|esub)\b/gi, ' ')
            .replace(/\[[^\]]*\]/g, ' ')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
    }

    function parseYear(text) {
        var found = String(text || '').match(/(?:19|20)\d{2}/g) || [];
        for (var i = 0; i < found.length; i++) {
            var n = parseInt(found[i], 10);
            if (n >= 1900 && n <= 2035) return n;
        }
        return null;
    }

    function qualityOf(url, title) {
        var m = [url, title].filter(Boolean).join(' ').match(/(2160p|1440p|1080p|720p|576p|540p|480p|360p|4k|uhd)/i);
        if (!m) return 'Unknown';
        var v = m[1].toLowerCase();
        return (v === '4k' || v === 'uhd') ? '2160p' : v;
    }

    function rankOf(quality) {
        var rank = QUALITY_RANK[quality];
        return rank === undefined ? -1 : rank;
    }

    function titleCase(text) {
        var words = text.split(/\s+/);
        for (var i = 0; i < words.length; i++) {
            if (words[i]) words[i] = words[i].charAt(0).toUpperCase() + words[i].slice(1);
        }
        return words.join(' ');
    }

    function extractMeta(name, title) {
        var audioMatches = String(title || '').match(/\b(dual[- ]?audio|multi[- ]?audio|dubbed|hindi[- ]?dubbed|eng[- ]?sub|bengali|hindi|dual|multi)\b/gi) || [];
        var audioTag = audioMatches.length ? audioMatches.join(' ').toUpperCase() : null;
        var cleaned = String(name || '').trim();
        if (!cleaned || cleaned.toLowerCase() === 'null') {
            cleaned = String(title || '')
                .replace(/\.[a-zA-Z0-9]{2,4}$/, '')
                .replace(/[._-]/g, ' ')
                .replace(/\b(19|20)\d{2}\b/g, '')
                .trim();
        }
        return { cleaned: titleCase(cleaned), audioTag: audioTag };
    }

    function isAnime(categories, title) {
        if (/\banime\b|\bdubbed anime\b|\bova\b|\bona\b/i.test(title || '')) return true;
        if (!Array.isArray(categories)) return false;
        return categories.some(function (c) {
            return String((c && (c.name || c.title)) || c || '').toLowerCase().indexOf('anime') !== -1;
        });
    }

    function sortTag(rank) {
        var bin = Math.max(0, MAX_RANK - rank).toString(2);
        var out = '';
        while (bin.length < 20) bin = '0' + bin;
        for (var i = 0; i < bin.length; i++) {
            out += bin.charAt(i) === '1' ? '\uFEFF' : '\u200B';
        }
        return out;
    }

    function getTmdbInfo(query) {
        var isTv = query.mediaType === 'tv';
        var url = TMDB_API + '/' + (isTv ? 'tv' : 'movie') + '/' + query.tmdbId + '?api_key=' + TMDB_KEY;
        return fetchJson(url, { 'Accept': 'application/json' }).then(function (data) {
            if (!data) return null;
            var title = isTv ? data.name : data.title;
            var date = isTv ? data.first_air_date : data.release_date;
            return { title: title || null, year: date ? parseInt(date.slice(0, 4), 10) : null };
        });
    }

    function searchPosts(title) {
        return circleGet('/api/posts?searchTerm=' + encodeURIComponent(title) + '&order=desc').then(function (text) {
            if (!text) return [];
            var obj = parseJson(text);
            if (!obj) return [];
            var raw = Array.isArray(obj) ? obj : (obj.posts || obj.data || []);
            if (!Array.isArray(raw)) return [];
            var posts = [];
            for (var i = 0; i < raw.length; i++) {
                var p = raw[i];
                if (!p || (p.type !== 'singleVideo' && p.type !== 'series')) continue;
                posts.push({
                    id: p.id,
                    type: p.type,
                    title: p.title || '',
                    name: p.name || '',
                    categories: p.categories || []
                });
            }
            return posts;
        });
    }

    function fetchPostDetail(id) {
        return circleGet('/api/posts/' + id).then(function (text) {
            if (!text) return null;
            var obj = parseJson(text);
            if (!obj) return null;
            return obj.post || obj.data || obj;
        });
    }

    function groupPosts(posts) {
        var groups = Object.create(null);
        var order = [];
        for (var i = 0; i < posts.length; i++) {
            var post = posts[i];
            var meta = extractMeta(post.name, post.title);
            var anime = isAnime(post.categories, post.title);
            var year = parseYear(post.title) || parseYear(post.name);
            var key = normalize(meta.cleaned) + (!anime && year ? '|' + year : '');
            if (!groups[key]) {
                groups[key] = { cleanedTitle: meta.cleaned, year: year, posts: [] };
                order.push(key);
            }
            groups[key].posts.push({ id: post.id, type: post.type, audioTag: meta.audioTag });
        }
        var list = [];
        for (var j = 0; j < order.length; j++) list.push(groups[order[j]]);
        return list;
    }

    function scoreGroup(group, targetNorm, targetYear, type) {
        var itemNorm = normalize(group.cleanedTitle);
        var score = -1;
        if (itemNorm === targetNorm) {
            score = 100;
            if (targetYear && group.year === targetYear) score += 50;
        } else if (targetNorm.length >= 4 && itemNorm.indexOf(targetNorm) !== -1) {
            score = 60;
            if (targetYear && group.year === targetYear) score += 30;
        } else if (itemNorm.length >= 4 && targetNorm.indexOf(itemNorm) !== -1) {
            score = 40;
        }
        var mainType = group.posts[0] && group.posts[0].type;
        if (type === 'movie' && mainType === 'singleVideo') score += 10;
        if (type === 'tv' && mainType === 'series') score += 10;
        return score;
    }

    function matchGroup(mediaInfo, posts, type) {
        if (!posts.length) return null;
        var targetNorm = normalize(mediaInfo.title);
        var groups = groupPosts(posts);
        var best = null;
        var bestScore = -1;
        for (var i = 0; i < groups.length; i++) {
            var score = scoreGroup(groups[i], targetNorm, mediaInfo.year, type);
            if (score > bestScore) {
                bestScore = score;
                best = groups[i];
            }
        }
        return bestScore >= 30 ? best : null;
    }

    function movieLinks(details) {
        var links = [];
        for (var i = 0; i < details.length; i++) {
            var obj = details[i].obj;
            var content = obj && obj.content;
            if (typeof content === 'string' && content.trim()) {
                links.push({ url: content.trim(), title: obj.title || '' });
            }
        }
        return links;
    }

    function episodeLinks(details, seasonNumber, episodeNumber) {
        var links = [];
        for (var d = 0; d < details.length; d++) {
            var obj = details[d].obj;
            if (!obj || !Array.isArray(obj.content)) continue;

            var byIndex = obj.content[seasonNumber - 1];
            if (byIndex && Array.isArray(byIndex.episodes)) {
                var direct = byIndex.episodes[episodeNumber - 1];
                var directUrl = String((direct && (direct.link || direct.url)) || '');
                if (directUrl) {
                    links.push({ url: directUrl, title: (direct && direct.title) || obj.title || '' });
                    continue;
                }
            }

            for (var si = 0; si < obj.content.length; si++) {
                var s = obj.content[si];
                if (!s) continue;
                var sNum = parseInt((String(s.seasonName || s.name || '').match(/\d+/) || [])[0], 10) || si + 1;
                if (sNum !== seasonNumber) continue;
                var eps = s.episodes || [];
                for (var ei = 0; ei < eps.length; ei++) {
                    var ep = eps[ei];
                    if (!ep) continue;
                    var eNum = parseInt(String(ep.episode || ep.number || ep.ep || ''), 10) || ei + 1;
                    if (eNum !== episodeNumber) continue;
                    var url = String(ep.link || ep.url || '');
                    if (url) links.push({ url: url, title: ep.title || obj.title || '' });
                }
            }
        }
        return links;
    }

    function buildStreams(links) {
        var seen = Object.create(null);
        var items = [];
        for (var i = 0; i < links.length; i++) {
            var l = links[i];
            if (!l.url || seen[l.url]) continue;
            seen[l.url] = true;
            var quality = qualityOf(l.url, l.title);
            var tag = sortTag(rankOf(quality));
            items.push({
                index: items.length,
                stream: {
                    name: tag + 'Circle FTP',
                    title: tag + 'Circle FTP \u2022 ' + quality,
                    url: l.url,
                    quality: quality,
                    headers: { 'User-Agent': USER_AGENT, 'Referer': BASE_URL + '/' }
                }
            });
        }
        items.sort(function (a, b) {
            var diff = rankOf(b.stream.quality) - rankOf(a.stream.quality);
            return diff !== 0 ? diff : a.index - b.index;
        });
        var streams = [];
        for (var j = 0; j < items.length; j++) streams.push(items[j].stream);
        return streams;
    }

    function hydrateGroup(group) {
        return Promise.all(group.posts.map(function (p) {
            return fetchPostDetail(p.id).then(function (obj) {
                return obj ? { obj: obj, type: p.type || obj.type } : null;
            });
        })).then(function (results) {
            return results.filter(Boolean);
        });
    }

    function findDetails(query) {
        return getTmdbInfo(query).then(function (info) {
            if (!info || !info.title) return null;
            return searchPosts(info.title).then(function (posts) {
                var group = matchGroup(info, posts, query.mediaType);
                return group ? hydrateGroup(group) : null;
            });
        });
    }

    function run() {
        var query = buildQuery();
        if (!query) return [];
        return findDetails(query).then(function (details) {
            if (!details || !details.length) return [];
            var links = query.mediaType === 'tv'
                ? episodeLinks(details, query.season, query.episode)
                : movieLinks(details);
            return buildStreams(links);
        });
    }

    return Promise.resolve().then(run).then(null, function () {
        return [];
    });
}

module.exports = { getStreams: getStreams };
