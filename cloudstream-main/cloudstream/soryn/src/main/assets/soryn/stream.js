(function () {
    "use strict";

    var g = typeof globalThis !== "undefined" ? globalThis : (typeof window !== "undefined" ? window : this);
    var runtimeManifest = (typeof manifest !== "undefined" && manifest) ? manifest : {};
    var BASE_URL = runtimeManifest.baseUrl || "https://net52.cc";

    var NEWTV_DOMAIN_SEEDS_B64 = [
        "aHR0cHM6Ly9tb2JpbGVkZXRlY3RzLmNvbQ==",
        "aHR0cHM6Ly9tb2JpbGVkZXRlY3QuYXBw",
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
        "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5pbms=",
        "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5saXZl",
        "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5wcm8=",
        "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5zdG9yZQ==",
        "aHR0cHM6Ly9tb2JpZGV0ZWN0cy50b3A=",
        "aHR0cHM6Ly9tb2JpZGV0ZWN0cy54eXo="
    ];

    var API_TTL = 86400000;
    var TOKEN_TTL = 3600000;
    var NEWTV_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:136.0) Gecko/20100101 Firefox/136.0 /OS.GatuNewTV v1.0";
    var PLAY_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";

    var OTT_BY_PROVIDER = {
        netflix: "nf", prime: "pv", hotstar: "hs",
        disney: "dp", marvel: "dp", starwars: "dp", pixar: "dp"
    };

    function base64Decode(str) {
        if (typeof atob === "function") return atob(str);
        throw new Error("atob is not available");
    }

    function cacheGet(key, ttl) {
        try { return g.cache ? g.cache.get(key, ttl) : null; } catch (e) { return null; }
    }

    function cacheSet(key, value) {
        try { if (g.cache) g.cache.set(key, value); } catch (e) {}
    }

    function getJson(url, headers) {
        return fetch(url, { method: "GET", headers: headers || {} })
            .then(function (res) { return res.text(); })
            .then(function (text) {
                try { return JSON.parse(text); } catch (e) { return null; }
            });
    }

    function resolveApiUrl(force) {
        if (!force) {
            var cached = cacheGet("newtv_api", API_TTL);
            if (cached) return Promise.resolve(cached);
        }

        var headers = {
            "X-Requested-With": "NetmirrorNewTV v1.0",
            "User-Agent": NEWTV_UA,
            "Accept": "application/json, text/plain, */*"
        };

        function tryDomain(i) {
            if (i >= NEWTV_DOMAIN_SEEDS_B64.length) {
                return Promise.reject(new Error("Failed to resolve NewTV API base URL from all seed domains"));
            }
            var domain;
            try {
                domain = base64Decode(NEWTV_DOMAIN_SEEDS_B64[i]).replace(/\/+$/, "");
            } catch (e) {
                return tryDomain(i + 1);
            }
            return getJson(domain + "/checknewtv.php", headers)
                .then(function (json) {
                    try {
                        if (json && json.token_hash && String(json.token_hash).trim()) {
                            var resolved = base64Decode(json.token_hash).replace(/\/+$/, "");
                            cacheSet("newtv_api", resolved);
                            return resolved;
                        }
                    } catch (e) {}
                    return null;
                }, function () { return null; })
                .then(function (resolved) {
                    return resolved || tryDomain(i + 1);
                });
        }

        return tryDomain(0);
    }

    function getNewTvUserToken(ott, force) {
        var backendOtt = (ott === "dp" || ott === "hs") ? "hs" : ott;
        var key = "newtv_token_" + backendOtt;

        if (!force) {
            var cached = cacheGet(key, TOKEN_TTL);
            if (cached) return Promise.resolve(cached);
        }

        return resolveApiUrl(false)
            .then(function (apiBase) {
                return getJson(apiBase + "/newtv/otp.php", {
                    "accept": "application/json, text/plain, */*",
                    "otp": "111111",
                    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:136.0) Gecko/20100101 Firefox/136.0 /OS.Gatu v1.0"
                });
            })
            .then(function (json) {
                if (json && json.usertoken) {
                    cacheSet(key, json.usertoken);
                    return json.usertoken;
                }
                throw new Error("Failed to obtain playback usertoken from OTP gateway");
            });
    }

    function parseMediaUrl(url) {
        var str = String(url || "").trim();
        var defaultOtt = OTT_BY_PROVIDER[String(runtimeManifest.providerId || "netflix").toLowerCase()] || "nf";

        if (str.charAt(0) === "{") {
            try {
                var obj = JSON.parse(str);
                if (obj && obj.id) return { id: String(obj.id), ott: obj.ott || defaultOtt };
            } catch (e) {}
        }

        var idMatch = str.match(/[?&]id=([^&#]+)/i) || str.match(/\/(?:post|watch|title|play|movies|series|episodes)\/([^/?#]+)/i);
        var ottMatch = str.match(/[?&]ott=([^&#]+)/i);
        var id = idMatch ? idMatch[1] : str.replace(/^https?:\/\/[^/]+/i, "").replace(/^\/+/, "");
        return { id: id, ott: ottMatch ? ottMatch[1] : defaultOtt };
    }

    function parseSubtitles(json) {
        var raw = json && (json.subtitles || json.subtitle || json.tracks);
        if (!Array.isArray(raw)) return [];
        var out = [];
        for (var i = 0; i < raw.length; i++) {
            var s = raw[i];
            if (!s || typeof s !== "object") continue;
            var url = s.url || s.file || s.src;
            if (!url) continue;
            var label = s.label || s.name || s.language || s.lang || "Subtitle";
            out.push({
                url: String(url),
                language: String(s.language || s.lang || label),
                name: String(label)
            });
        }
        return out;
    }

    function loadStreams(url, cb) {
        var media;
        try {
            media = parseMediaUrl(url);
            if (!media.id) throw new Error("Invalid or missing media id: " + String(url));
        } catch (e) {
            cb({ success: false, errorCode: "STREAM_ERROR", message: String(e && (e.stack || e.message) || e) });
            return;
        }

        var playerOtt = (media.ott === "dp" || media.ott === "hs") ? "hs" : media.ott;

        resolveApiUrl(false)
            .then(function (apiBase) {
                var playerUrl = apiBase + "/newtv/player.php?id=" + encodeURIComponent(media.id);

                function fetchPlayer(forceToken) {
                    return getNewTvUserToken(playerOtt, forceToken).then(function (token) {
                        return getJson(playerUrl, {
                            "Ott": playerOtt,
                            "Usertoken": token,
                            "X-Requested-With": "NetmirrorNewTV v1.0",
                            "User-Agent": NEWTV_UA
                        });
                    });
                }

                return fetchPlayer(false).then(function (json) {
                    if (!json || !json.video_link) return fetchPlayer(true);
                    return json;
                });
            })
            .then(function (json) {
                if (json && json.video_link) {
                    cb({
                        success: true,
                        data: [{
                            url: json.video_link,
                            quality: "Auto",
                            name: "NetMirror",
                            type: "hls",
                            headers: {
                                "Referer": json.referer || BASE_URL,
                                "User-Agent": PLAY_UA
                            },
                            subtitles: parseSubtitles(json)
                        }]
                    });
                } else {
                    throw new Error("Invalid or empty response from player API: " + JSON.stringify(json));
                }
            })
            .catch(function (e) {
                cb({ success: false, errorCode: "STREAM_ERROR", message: String(e && (e.stack || e.message) || e) });
            });
    }

    g.loadStreams = loadStreams;
    if (typeof module !== "undefined" && module.exports) {
        module.exports = { loadStreams: loadStreams };
    }
})();
