var core = globalThis.PlayzCore;
var trimToString = core.trimToString;
var safeJsonParse = core.safeJsonParse;
var mergeHeaders = core.mergeHeaders;
var extend = core.extend;
var errText = core.errText;
var extractResponseBody = core.extractResponseBody;
var extractResponseStatus = core.extractResponseStatus;

var REQUEST_TIMEOUT_MS = 15000;
var CONCURRENCY = 6;
var CHROME_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";
var MOBILE_UA = "Mozilla/5.0 (Linux; Android 10; Pixel 3 XL) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36";
var PLAYZ_TRUSTED_HOSTS = [
    "a201aivottlinear-a.akamaihd.net",
    "otte.live.cf.ww.aiv-cdn.net",
    "in-mc-flive.fancode.com",
    "livevideos.cricbuzz.com",
    "livetv.hotstar.com",
    "jiotvpllive.cdn.jio.com",
    "dice-live-oc.akamaized.net"
];
var PLAYZ_WEAK_HOSTS = [
    "winner-api.icu",
    "mainstreams.pro",
    "smarthard.click",
    "chatgpt.hereisman.net",
    "windows-devs.top",
    "firebase-api.com",
    "195.178.110.2"
];
var NO_TOKEN = { url: "", headers: {} };

function fetchText(url, headers) {
    return core.fetchText(url, headers, REQUEST_TIMEOUT_MS);
}

function fetchWithMethod(url, requestType, headers, body, bodyType) {
    if (trimToString(requestType).toLowerCase() !== "post") return fetchText(url, headers);
    var postHeaders = extend({}, headers || {});
    var type = trimToString(bodyType).toLowerCase();
    if (!postHeaders["Content-Type"]) {
        postHeaders["Content-Type"] = type === "json" ? "application/json"
            : type === "text" ? "text/plain; charset=utf-8"
            : "application/x-www-form-urlencoded; charset=utf-8";
    }
    return core.postText(url, postHeaders, body || "", REQUEST_TIMEOUT_MS);
}

function normalizeHeaderName(key) {
    if (!key) return "";
    var lowered = trimToString(key).toLowerCase();
    if (lowered === "user-agent") return "User-Agent";
    if (lowered === "referer" || lowered === "referrer") return "Referer";
    if (lowered === "origin") return "Origin";
    if (lowered === "cookie") return "Cookie";
    return trimToString(key);
}

function normalizeDrmScheme(value) {
    var normalized = trimToString(value).toLowerCase();
    if (!normalized) return "";
    if (normalized.indexOf("widevine") !== -1) return "widevine";
    if (normalized.indexOf("clearkey") !== -1 || normalized.indexOf("clear") !== -1) return "clearkey";
    return normalized;
}

function normalizeDrmToken(value) {
    var normalized = trimToString(value);
    if (!normalized) return "";
    if (/^[0-9a-f-]{32,}$/i.test(normalized)) return normalized.replace(/-/g, "").toLowerCase();
    return normalized;
}

function splitUrlAndHeaders(rawUrl) {
    var value = trimToString(rawUrl);
    var result = { url: value, headers: {}, userAgent: "", cookie: "", drmScheme: "", licenseUrl: "", key: "", keyid: "" };
    if (!value || value.indexOf("|") === -1) return result;

    var parts = value.split("|", 2);
    result.url = trimToString(parts[0]);
    trimToString(parts[1] || "").split("&").forEach(function (pair) {
        var equalsIndex = pair.indexOf("=");
        if (equalsIndex === -1) return;

        var rawKey = trimToString(pair.slice(0, equalsIndex));
        if (!rawKey) return;

        var rawValue = trimToString(pair.slice(equalsIndex + 1));
        try { rawValue = decodeURIComponent(rawValue); } catch (e) {}

        var lowered = rawKey.toLowerCase();
        if (lowered === "drmlicense" || lowered === "licenseurl") { result.licenseUrl = rawValue; return; }
        if (lowered === "drmscheme") { result.drmScheme = normalizeDrmScheme(rawValue); return; }
        if (lowered === "key") { result.key = rawValue; return; }
        if (lowered === "keyid") { result.keyid = rawValue; return; }

        var key = normalizeHeaderName(rawKey);
        if (!key) return;
        result.headers[key] = rawValue;
        if (key === "User-Agent") result.userAgent = rawValue;
        if (key === "Cookie") result.cookie = rawValue;
    });
    return result;
}

function decodeEscapedText(text) {
    if (!text) return "";
    return String(text).replace(/\\u0026/g, "&").replace(/\\\//g, "/");
}

function tryDecodeReversedTokenPayload(text, key) {
    if (!text || typeof text !== "string") return "";
    try {
        var reversed = String(text).split("").reverse().join("");
        var decoded = atob(reversed);
        var parts = decoded.split("|", 2);
        if (parts.length !== 2) return "";
        var shift = parseInt(parts[0], 10);
        if (!isFinite(shift)) return "";

        var decodedJson = "";
        for (var n = 0; n < parts[1].length; n++) {
            var ch = parts[1].charAt(n);
            var code = ch.charCodeAt(0);
            if (code >= 65 && code <= 90) {
                decodedJson += String.fromCharCode(((code - 65 - shift + 26) % 26) + 65);
            } else if (code >= 97 && code <= 122) {
                decodedJson += String.fromCharCode(((code - 97 - shift + 26) % 26) + 97);
            } else {
                decodedJson += ch;
            }
        }
        var data = safeJsonParse(decodedJson);
        return trimToString(data && data[key]);
    } catch (e) {
        return "";
    }
}

function extractJsonPlaybackUrl(text, key) {
    if (!text) return "";
    var normalizedKey = trimToString(key) || "playback_url";
    var data = safeJsonParse(text);
    if (data && typeof data === "object") {
        var direct = trimToString(data[normalizedKey]);
        if (direct) return decodeEscapedText(direct);
    }

    var reversed = tryDecodeReversedTokenPayload(text, normalizedKey);
    if (reversed) return decodeEscapedText(reversed);

    var escapedKey = normalizedKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    var match = new RegExp('"' + escapedKey + '"\\s*:\\s*"([^"]+)"', "i").exec(String(text));
    if (match && match[1]) return decodeEscapedText(match[1]);
    return "";
}

function extractDirectMediaUrl(text) {
    if (!text) return "";
    var patterns = [
        /https?:\/\/[^"'\\\s<>]+?\.(?:m3u8|mpd)(?:[^"'\\\s<>]*)/ig,
        /https?:\\\/\\\/[^"'\\\s<>]+?\.(?:m3u8|mpd)(?:[^"'\\\s<>]*)/ig,
        /"hlsManifestUrl"\s*:\s*"([^"]+)"/ig,
        /"playback_url"\s*:\s*"([^"]+)"/ig
    ];
    for (var p = 0; p < patterns.length; p++) {
        var matches = String(text).match(patterns[p]);
        if (!matches || !matches.length) continue;
        for (var m = 0; m < matches.length; m++) {
            var normalized = decodeEscapedText(matches[m])
                .replace(/^"hlsManifestUrl"\s*:\s*"/i, "")
                .replace(/^"playback_url"\s*:\s*"/i, "")
                .replace(/"$/, "");
            if (normalized && (/\.m3u8/i.test(normalized) || /\.mpd/i.test(normalized))) return normalized;
        }
    }
    return "";
}

function resolveEmbedToken(tokenConfig) {
    var request = splitUrlAndHeaders(tokenConfig.api || "");
    if (!request.url || request.url.indexOf("%s") !== -1) return Promise.resolve(NO_TOKEN);
    return fetchText(request.url, mergeHeaders({ "User-Agent": CHROME_UA }, request.headers)).then(function (response) {
        var status = extractResponseStatus(response);
        if (status < 200 || status >= 300) return NO_TOKEN;
        var html = extractResponseBody(response);
        var resolved = extractJsonPlaybackUrl(html, tokenConfig.link_key || "playback_url") || extractDirectMediaUrl(html);
        var parsed = splitUrlAndHeaders(resolved);
        return { url: parsed.url, headers: mergeHeaders(request.headers, parsed.headers) };
    }).then(null, function () {
        return NO_TOKEN;
    });
}

function resolveStructuredToken(tokenConfig) {
    var request = splitUrlAndHeaders(tokenConfig.api || "");
    if (!request.url || request.url.indexOf("%s") !== -1) return Promise.resolve(NO_TOKEN);
    return fetchWithMethod(
        request.url,
        tokenConfig.request_type || "get",
        request.headers,
        tokenConfig.request_body || "",
        tokenConfig.request_body_type || "normal"
    ).then(function (response) {
        var status = extractResponseStatus(response);
        if (status < 200 || status >= 300) return NO_TOKEN;
        var resolved = extractJsonPlaybackUrl(extractResponseBody(response), tokenConfig.link_key || "playback_url");
        if (!resolved) return NO_TOKEN;
        var parsed = splitUrlAndHeaders(resolved);
        return { url: parsed.url, headers: mergeHeaders(request.headers, parsed.headers) };
    }).then(null, function () {
        return NO_TOKEN;
    });
}

function resolveTokenizedStream(entry) {
    if (!entry || typeof entry.tokenApi !== "string" || !entry.tokenApi) return Promise.resolve(null);
    var tokenConfig = safeJsonParse(entry.tokenApi);
    if (!tokenConfig || typeof tokenConfig !== "object") return Promise.resolve(null);

    var tokenType = trimToString(tokenConfig.type || "token").toLowerCase();
    var pending = null;
    if (tokenType === "sp" || tokenType === "json") {
        pending = resolveStructuredToken(tokenConfig);
    } else if (tokenType === "embed" || tokenType === "html" || tokenType === "yt") {
        pending = resolveEmbedToken(tokenConfig);
    }
    if (!pending) return Promise.resolve(null);
    return pending.then(function (resolved) {
        return resolved && resolved.url ? resolved : null;
    }, function () {
        return null;
    });
}

function matchesHost(host, entries) {
    if (!host) return false;
    return entries.some(function (entry) { return host === entry || host.slice(-(entry.length + 1)) === "." + entry; });
}

function isHlsUrl(url) { return /\.m3u8(?:$|[?#])/i.test(url) || /\/hls\//i.test(url); }
function isDashUrl(url) { return /\.mpd(?:$|[?#])/i.test(url); }

function parseHlsAttributes(line) {
    var attributes = {};
    var regex = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
    var match;
    var source = String(line || "");
    while ((match = regex.exec(source)) !== null) {
        var key = trimToString(match[1]).toUpperCase();
        var value = trimToString(match[2]).replace(/^"|"$/g, "");
        if (key) attributes[key] = value;
    }
    return attributes;
}

function resolveVariantUrl(baseUrl, variantPath) {
    var target = trimToString(variantPath);
    if (!target) return "";
    var resolved = core.resolveUrl(target, baseUrl);
    if (!resolved) return target;
    var base = core.parseUrl(baseUrl);
    var out = core.parseUrl(resolved);
    if (out && base && !out.search && target.indexOf("?") === -1 && base.search) {
        var hashAt = resolved.indexOf("#");
        var head = hashAt === -1 ? resolved : resolved.slice(0, hashAt);
        var tail = hashAt === -1 ? "" : resolved.slice(hashAt);
        return head + base.search + tail;
    }
    return resolved;
}

function parseVariantQuality(attributes) {
    if (!attributes) return 0;
    var resolutionMatch = /(\d+)\s*x\s*(\d+)/i.exec(trimToString(attributes.RESOLUTION));
    if (resolutionMatch) return parseInt(resolutionMatch[2], 10) || 0;

    var bandwidth = parseInt(attributes["AVERAGE-BANDWIDTH"] || attributes.BANDWIDTH || "0", 10);
    if (!bandwidth || bandwidth < 1) return 0;
    if (bandwidth >= 20000000) return 8160;
    if (bandwidth >= 10000000) return 4320;
    if (bandwidth >= 6000000) return 1080;
    if (bandwidth >= 3000000) return 720;
    if (bandwidth >= 1500000) return 480;
    if (bandwidth >= 800000) return 360;
    if (bandwidth >= 400000) return 240;
    if (bandwidth >= 200000) return 144;
    return 0;
}

function buildVariantSource(baseSource, attributes, fallbackIndex) {
    var quality = parseVariantQuality(attributes);
    if (quality > 0) return { quality: quality, source: baseSource + " " + quality + "p" };
    var bandwidth = parseInt((attributes && (attributes["AVERAGE-BANDWIDTH"] || attributes.BANDWIDTH)) || "0", 10);
    if (bandwidth > 0) return { quality: 0, source: baseSource + " " + Math.max(1, Math.round(bandwidth / 1000)) + "kbps" };
    return { quality: 0, source: baseSource + " Variant " + (fallbackIndex + 1) };
}

function parseHlsMasterPlaylist(manifestText, manifestUrl) {
    var variants = [];
    var pending = null;
    String(manifestText || "").split(/\r?\n/).forEach(function (rawLine) {
        var line = trimToString(rawLine);
        if (!line) return;
        if (line.indexOf("#EXT-X-STREAM-INF:") === 0) {
            pending = parseHlsAttributes(line.slice("#EXT-X-STREAM-INF:".length));
            return;
        }
        if (line.charAt(0) === "#") return;
        if (pending) {
            var resolved = resolveVariantUrl(manifestUrl, line);
            if (resolved) variants.push({ url: resolved, attributes: pending });
            pending = null;
        }
    });
    return variants;
}

function expandHlsStreams(sourceLabel, parsed, drmInfo) {
    if (!parsed || !parsed.url || !isHlsUrl(parsed.url)) return Promise.resolve([]);
    var headers = drmInfo && drmInfo.headers ? drmInfo.headers : (parsed.headers || {});
    return fetchText(parsed.url, headers).then(function (response) {
        var status = extractResponseStatus(response);
        if (status < 200 || status >= 300) return [];

        var manifestText = trimToString(extractResponseBody(response));
        if (manifestText.indexOf("#EXTM3U") !== 0 || manifestText.indexOf("#EXT-X-STREAM-INF") === -1) return [];

        var seen = {};
        var streams = [];
        parseHlsMasterPlaylist(manifestText, parsed.url).forEach(function (variant, index) {
            var playbackUrl = trimToString(variant.url);
            if (!playbackUrl || seen[playbackUrl]) return;
            seen[playbackUrl] = true;
            var info = buildVariantSource(sourceLabel, variant.attributes || {}, index);
            streams.push({ source: info.source, url: playbackUrl, headers: headers, quality: info.quality });
        });
        return streams;
    }).then(null, function () {
        return [];
    });
}

function createStreamResult(source, parsed, drmInfo, quality) {
    var headers = mergeHeaders(drmInfo && drmInfo.headers ? drmInfo.headers : (parsed.headers || {}));
    var label = source || "Auto";
    var stream = {
        name: label,
        source: label,
        url: parsed.url,
        headers: headers,
        type: isDashUrl(parsed.url) ? "dash" : (isHlsUrl(parsed.url) ? "hls" : undefined),
        quality: typeof quality === "number" && quality > 0 ? quality : undefined
    };
    if (drmInfo && drmInfo.drmKey && drmInfo.drmKid) {
        stream.drmKey = drmInfo.drmKey;
        stream.drmKid = drmInfo.drmKid;
        stream.drmType = normalizeDrmScheme(drmInfo.drmType) || "clearkey";
    } else if (drmInfo && drmInfo.licenseUrl) {
        stream.licenseUrl = drmInfo.licenseUrl;
        stream.drmLicenseUrl = drmInfo.licenseUrl;
        stream.drmType = normalizeDrmScheme(drmInfo.drmType) || "widevine";
    }
    return stream;
}

function scoreStream(sourceLabel, parsed, hasDrm, quality, isVariant) {
    var url = trimToString(parsed && parsed.url);
    var headers = parsed && parsed.headers && typeof parsed.headers === "object" ? parsed.headers : {};
    var source = trimToString(sourceLabel).toLowerCase();
    var host = core.hostOf(url);

    var score = 0;
    if (/^https?:\/\//i.test(url)) score += 10;
    if (isDashUrl(url)) score += 25;
    if (isHlsUrl(url)) score += 15;
    if (hasDrm) score += 45;
    if (Object.keys(headers).length) score += 4;
    if (headers.Cookie) score += 8;
    if (headers.Referer) score += 6;
    if (headers["User-Agent"]) score += 2;
    if (typeof quality === "number" && quality > 0) score += Math.min(Math.round(quality / 180), 6);

    if (matchesHost(host, PLAYZ_TRUSTED_HOSTS)) score += 20;
    if (matchesHost(host, PLAYZ_WEAK_HOSTS)) score -= 30;

    if (source.indexOf("low") !== -1) score -= 12;
    if (source.indexOf("sd") !== -1) score -= 5;
    if (source.indexOf("backup") !== -1) score -= 3;
    if (isVariant) score -= 1;
    return score;
}

function createRankedStream(source, parsed, drmInfo, quality, order, isVariant) {
    var headers = drmInfo && drmInfo.headers ? drmInfo.headers : (parsed.headers || {});
    var hasDrm = !!(drmInfo && ((drmInfo.drmKey && drmInfo.drmKid) || drmInfo.licenseUrl));
    return {
        score: scoreStream(source, { url: parsed.url, headers: headers }, hasDrm, quality, isVariant),
        order: order,
        stream: createStreamResult(source, parsed, drmInfo, quality)
    };
}

function buildResolvedStream(entry) {
    return resolveTokenizedStream(entry).then(function (tokenResolved) {
        if (tokenResolved && tokenResolved.url) {
            var parsedToken = splitUrlAndHeaders(tokenResolved.url);
            return {
                url: parsedToken.url,
                headers: mergeHeaders(tokenResolved.headers, parsedToken.headers),
                drmScheme: parsedToken.drmScheme,
                licenseUrl: parsedToken.licenseUrl,
                key: parsedToken.key,
                keyid: parsedToken.keyid
            };
        }
        var parsed = splitUrlAndHeaders(entry && entry.link);
        return parsed.url ? parsed : null;
    });
}

function resolveStreamDrm(rawApi, parsed, baseHeaders) {
    var headers = mergeHeaders(baseHeaders, parsed.headers);
    var drmScheme = normalizeDrmScheme(parsed.drmScheme);
    var drmKey = normalizeDrmToken(parsed.key);
    var drmKid = normalizeDrmToken(parsed.keyid);
    var licenseUrl = trimToString(parsed.licenseUrl);

    var rawValue = trimToString(rawApi);
    if (rawValue) {
        if (/^https?:\/\//i.test(rawValue)) {
            licenseUrl = rawValue;
            drmScheme = "widevine";
        } else if (rawValue.indexOf(":") !== -1) {
            var parts = rawValue.split(":");
            if (parts.length === 2) {
                drmKid = normalizeDrmToken(parts[0]);
                drmKey = normalizeDrmToken(parts[1]);
                drmScheme = "clearkey";
            }
        }
    }

    return {
        headers: headers,
        drmType: drmKey && drmKid ? "clearkey" : (drmScheme || (licenseUrl ? "widevine" : "")),
        drmKey: drmKey,
        drmKid: drmKid,
        licenseUrl: licenseUrl
    };
}

function processStreamEntry(entry, index) {
    if (!entry || typeof entry !== "object") return Promise.resolve([]);
    return buildResolvedStream(entry).then(function (resolved) {
        if (!resolved || !resolved.url) return [];

        var rawApi = trimToString(entry.api);
        var sourceLabel = trimToString(entry.name) || "Server " + (index + 1);

        if (/\.m3u(?:8)?(?:$|[?#])/i.test(resolved.url) && (!resolved.headers || !resolved.headers["User-Agent"])) {
            resolved.headers = mergeHeaders(resolved.headers, { "User-Agent": MOBILE_UA });
        }

        var drmInfo = resolveStreamDrm(rawApi, resolved, resolved.headers);
        var ranked = [createRankedStream(sourceLabel, resolved, drmInfo, 0, index * 100, false)];

        return expandHlsStreams(sourceLabel, resolved, drmInfo).then(function (variants) {
            variants.forEach(function (variant, variantIndex) {
                ranked.push(createRankedStream(
                    variant.source,
                    { url: variant.url, headers: variant.headers },
                    drmInfo,
                    variant.quality,
                    index * 100 + variantIndex + 1,
                    true
                ));
            });
            return ranked;
        });
    });
}

function loadStreams(urlStr, cb) {
    if (!urlStr || typeof urlStr !== "string") {
        cb({ success: false, errorCode: "INVALID_INPUT", message: "Invalid URL string" });
        return;
    }
    Promise.resolve().then(function () {
        var data = JSON.parse(urlStr);
        if (!data || typeof data !== "object") throw new Error("Invalid event data format");

        var slug = trimToString(data.slug);
        var targetPath = slug ? slug + ".txt" : trimToString(data.linksPath);
        if (!targetPath) {
            return { success: false, errorCode: "PARSE_ERROR", message: "Missing PlayZTV links path" };
        }

        return core.fetchPlayzJson(targetPath, REQUEST_TIMEOUT_MS).then(function (response) {
            if (!Array.isArray(response) || !response.length) {
                return { success: false, errorCode: "EMPTY_RESULT", message: "No streams found for this event" };
            }
            return core.mapWithConcurrency(response, CONCURRENCY, processStreamEntry).then(function (lists) {
                var ranked = lists.reduce(function (all, entryStreams) { return all.concat(entryStreams || []); }, []);
                if (!ranked.length) {
                    return { success: false, errorCode: "EMPTY_RESULT", message: "No playable streams resolved for this event" };
                }
                ranked.sort(function (left, right) {
                    return right.score !== left.score ? right.score - left.score : left.order - right.order;
                });
                return { success: true, data: ranked.map(function (entry) { return entry.stream; }) };
            });
        });
    }).then(null, function (error) {
        return { success: false, errorCode: "PARSE_ERROR", message: "Failed to load streams: " + errText(error) };
    }).then(cb);
}

globalThis.loadStreams = loadStreams;
