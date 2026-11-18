(function (g) {
    "use strict";

    var FIREBASE_CONFIG = {
        packageName: "com.playz.tv",
        apiKey: "AIzaSyDKRqLlbaZBIpHzLBiQTUrJqr3gN-nDWWc",
        appId: "1:516859456626:android:12a75869902c4f8a6826eb",
        projectNumber: "516859456626",
        sdkVersion: "22.1.0",
        appVersion: "2.1",
        appBuild: "4"
    };
    var DEFAULT_BASE_URLS = [
        "https://tourniquest.site",
        "https://adsflw.xyz"
    ];
    var BASE_URL_TTL = 3600000;

    var NATIVE_KEY = new Uint8Array([99, 122, 49, 52, 82, 83, 116, 107, 78, 48, 49, 80, 86, 69, 53, 119]);
    var NATIVE_IV = new Uint8Array([87, 84, 108, 69, 118, 99, 107, 100, 50, 85, 82, 52, 49, 115, 100, 107]);
    var PRIMARY_KEY = new Uint8Array([98, 47, 49, 106, 109, 108, 53, 110, 107, 52, 120, 53, 107, 55, 112, 78]);
    var PRIMARY_IV = new Uint8Array([49, 52, 110, 77, 107, 56, 109, 78, 53, 75, 108, 53, 75, 76, 55, 108]);
    var FALLBACK_KEY = new Uint8Array([109, 53, 75, 108, 53, 110, 107, 52, 120, 75, 49, 107, 78, 55, 112, 78]);
    var FALLBACK_IV = new Uint8Array([107, 53, 75, 52, 110, 77, 56, 109, 75, 108, 78, 76, 55, 108, 49, 53]);

    var SUBSTITUTION_FROM = "aAbBcCdDeEfFgGhHiIjJkKlLmMnNoOpPqQrRsStTuUvVwWxXyYzZ";
    var SUBSTITUTION_TO = "fFgGjJkKaApPbBmMoOzZeEnNcCdDrRqQtTvVuUxXhHiIwWyYlLsS";
    var SUBSTITUTION_REVERSE = {};
    for (var si = 0; si < SUBSTITUTION_TO.length; si++) {
        SUBSTITUTION_REVERSE[SUBSTITUTION_TO.charAt(si)] = SUBSTITUTION_FROM.charAt(si);
    }

    var AES = (function () {
        var S = [
            99, 124, 119, 123, 242, 107, 111, 197, 48, 1, 103, 43, 254, 215, 171, 118,
            202, 130, 201, 125, 250, 89, 71, 240, 173, 212, 162, 175, 156, 164, 114, 192,
            183, 253, 147, 38, 54, 63, 247, 204, 52, 165, 229, 241, 113, 216, 49, 21,
            4, 199, 35, 195, 24, 150, 5, 154, 7, 18, 128, 226, 235, 39, 178, 117,
            9, 131, 44, 26, 27, 110, 90, 160, 82, 59, 214, 179, 41, 227, 47, 132,
            83, 209, 0, 237, 32, 252, 177, 91, 106, 203, 190, 57, 74, 76, 88, 207,
            208, 239, 170, 251, 67, 77, 51, 133, 69, 249, 2, 127, 80, 60, 159, 168,
            81, 163, 64, 143, 146, 157, 56, 245, 188, 182, 218, 33, 16, 255, 243, 210,
            205, 12, 19, 236, 95, 151, 68, 23, 196, 167, 126, 61, 100, 93, 25, 115,
            96, 129, 79, 220, 34, 42, 144, 136, 70, 238, 184, 20, 222, 94, 11, 219,
            224, 50, 58, 10, 73, 6, 36, 92, 194, 211, 172, 98, 145, 149, 228, 121,
            231, 200, 55, 109, 141, 213, 78, 169, 108, 86, 244, 234, 101, 122, 174, 8,
            186, 120, 37, 46, 28, 166, 180, 198, 232, 221, 116, 31, 75, 189, 139, 138,
            112, 62, 181, 102, 72, 3, 246, 14, 97, 53, 87, 185, 134, 193, 29, 158,
            225, 248, 152, 17, 105, 217, 142, 148, 155, 30, 135, 233, 206, 85, 40, 223,
            140, 161, 137, 13, 191, 230, 66, 104, 65, 153, 45, 15, 176, 84, 187, 22
        ];
        var Si = new Array(256);
        var i;
        for (i = 0; i < 256; i++) Si[S[i]] = i;
        var Rcon = [0x00, 0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1B, 0x36];
        var Td0 = new Uint32Array(256), Td1 = new Uint32Array(256), Td2 = new Uint32Array(256), Td3 = new Uint32Array(256);
        for (i = 0; i < 256; i++) {
            var s = Si[i];
            var s2 = (s << 1) ^ ((s & 0x80) ? 0x11b : 0);
            var s4 = (s2 << 1) ^ ((s2 & 0x80) ? 0x11b : 0);
            var s8 = (s4 << 1) ^ ((s4 & 0x80) ? 0x11b : 0);
            var e = s8 ^ s4 ^ s2;
            var b = s8 ^ s2 ^ s;
            var d = s8 ^ s4 ^ s;
            var nine = s8 ^ s;
            Td0[i] = ((e << 24) | (nine << 16) | (d << 8) | b) >>> 0;
            Td1[i] = ((b << 24) | (e << 16) | (nine << 8) | d) >>> 0;
            Td2[i] = ((d << 24) | (b << 16) | (e << 8) | nine) >>> 0;
            Td3[i] = ((nine << 24) | (d << 16) | (b << 8) | e) >>> 0;
        }

        function keyExpansion(key) {
            var Nk = Math.floor(key.length / 4);
            var Nr = Nk + 6;
            var w = new Uint32Array(4 * (Nr + 1));
            var n, temp;
            for (n = 0; n < Nk; n++) {
                w[n] = ((key[4 * n] << 24) | (key[4 * n + 1] << 16) | (key[4 * n + 2] << 8) | key[4 * n + 3]) >>> 0;
            }
            for (n = Nk; n < 4 * (Nr + 1); n++) {
                temp = w[n - 1];
                if (n % Nk === 0) {
                    temp = (temp << 8) | (temp >>> 24);
                    temp = ((S[(temp >>> 24) & 0xff] << 24) |
                            (S[(temp >>> 16) & 0xff] << 16) |
                            (S[(temp >>> 8) & 0xff] << 8) |
                            S[temp & 0xff]) ^ (Rcon[Math.floor(n / Nk)] << 24);
                } else if (Nk > 6 && n % Nk === 4) {
                    temp = (S[(temp >>> 24) & 0xff] << 24) |
                           (S[(temp >>> 16) & 0xff] << 16) |
                           (S[(temp >>> 8) & 0xff] << 8) |
                           S[temp & 0xff];
                }
                w[n] = (w[n - Nk] ^ temp) >>> 0;
            }
            var dw = new Uint32Array(w.length);
            for (var r = 0; r <= Nr; r++) {
                for (var c = 0; c < 4; c++) {
                    var idx = r * 4 + c;
                    if (r === 0 || r === Nr) {
                        dw[idx] = w[idx];
                    } else {
                        var val = w[idx];
                        dw[idx] = (Td0[S[(val >>> 24) & 0xff]] ^ Td1[S[(val >>> 16) & 0xff]] ^ Td2[S[(val >>> 8) & 0xff]] ^ Td3[S[val & 0xff]]) >>> 0;
                    }
                }
            }
            return { dw: dw, Nr: Nr };
        }

        function decryptBlock(inBytes, inOffset, outBytes, outOffset, dw, Nr) {
            var s0 = ((inBytes[inOffset] << 24) | (inBytes[inOffset + 1] << 16) | (inBytes[inOffset + 2] << 8) | inBytes[inOffset + 3]) ^ dw[Nr * 4];
            var s1 = ((inBytes[inOffset + 4] << 24) | (inBytes[inOffset + 5] << 16) | (inBytes[inOffset + 6] << 8) | inBytes[inOffset + 7]) ^ dw[Nr * 4 + 1];
            var s2 = ((inBytes[inOffset + 8] << 24) | (inBytes[inOffset + 9] << 16) | (inBytes[inOffset + 10] << 8) | inBytes[inOffset + 11]) ^ dw[Nr * 4 + 2];
            var s3 = ((inBytes[inOffset + 12] << 24) | (inBytes[inOffset + 13] << 16) | (inBytes[inOffset + 14] << 8) | inBytes[inOffset + 15]) ^ dw[Nr * 4 + 3];
            s0 >>>= 0; s1 >>>= 0; s2 >>>= 0; s3 >>>= 0;
            var t0, t1, t2, t3;
            for (var r = Nr - 1; r > 0; r--) {
                var k = r * 4;
                t0 = (Td0[(s0 >>> 24) & 0xff] ^ Td1[(s3 >>> 16) & 0xff] ^ Td2[(s2 >>> 8) & 0xff] ^ Td3[s1 & 0xff] ^ dw[k]) >>> 0;
                t1 = (Td0[(s1 >>> 24) & 0xff] ^ Td1[(s0 >>> 16) & 0xff] ^ Td2[(s3 >>> 8) & 0xff] ^ Td3[s2 & 0xff] ^ dw[k + 1]) >>> 0;
                t2 = (Td0[(s2 >>> 24) & 0xff] ^ Td1[(s1 >>> 16) & 0xff] ^ Td2[(s0 >>> 8) & 0xff] ^ Td3[s3 & 0xff] ^ dw[k + 2]) >>> 0;
                t3 = (Td0[(s3 >>> 24) & 0xff] ^ Td1[(s2 >>> 16) & 0xff] ^ Td2[(s1 >>> 8) & 0xff] ^ Td3[s0 & 0xff] ^ dw[k + 3]) >>> 0;
                s0 = t0; s1 = t1; s2 = t2; s3 = t3;
            }
            var k0 = dw[0], k1 = dw[1], k2 = dw[2], k3 = dw[3];
            outBytes[outOffset]      = ((Si[(s0 >>> 24) & 0xff] << 24) ^ k0) >>> 24;
            outBytes[outOffset + 1]  = ((Si[(s3 >>> 16) & 0xff] << 16) ^ k0) >>> 16;
            outBytes[outOffset + 2]  = ((Si[(s2 >>> 8) & 0xff] << 8) ^ k0) >>> 8;
            outBytes[outOffset + 3]  = (Si[s1 & 0xff] ^ k0) & 0xff;
            outBytes[outOffset + 4]  = ((Si[(s1 >>> 24) & 0xff] << 24) ^ k1) >>> 24;
            outBytes[outOffset + 5]  = ((Si[(s0 >>> 16) & 0xff] << 16) ^ k1) >>> 16;
            outBytes[outOffset + 6]  = ((Si[(s3 >>> 8) & 0xff] << 8) ^ k1) >>> 8;
            outBytes[outOffset + 7]  = (Si[s2 & 0xff] ^ k1) & 0xff;
            outBytes[outOffset + 8]  = ((Si[(s2 >>> 24) & 0xff] << 24) ^ k2) >>> 24;
            outBytes[outOffset + 9]  = ((Si[(s1 >>> 16) & 0xff] << 16) ^ k2) >>> 16;
            outBytes[outOffset + 10] = ((Si[(s0 >>> 8) & 0xff] << 8) ^ k2) >>> 8;
            outBytes[outOffset + 11] = (Si[s3 & 0xff] ^ k2) & 0xff;
            outBytes[outOffset + 12] = ((Si[(s3 >>> 24) & 0xff] << 24) ^ k3) >>> 24;
            outBytes[outOffset + 13] = ((Si[(s2 >>> 16) & 0xff] << 16) ^ k3) >>> 16;
            outBytes[outOffset + 14] = ((Si[(s1 >>> 8) & 0xff] << 8) ^ k3) >>> 8;
            outBytes[outOffset + 15] = (Si[s0 & 0xff] ^ k3) & 0xff;
        }

        return {
            decryptCbc: function (ciphertext, key, iv) {
                if (!ciphertext || !ciphertext.length) return new Uint8Array(0);
                var ks = keyExpansion(key);
                var plain = new Uint8Array(ciphertext.length);
                var blockOut = new Uint8Array(16);
                var prev = iv;
                var prevOffset = 0;
                for (var p = 0; p + 16 <= ciphertext.length; p += 16) {
                    decryptBlock(ciphertext, p, blockOut, 0, ks.dw, ks.Nr);
                    for (var j = 0; j < 16; j++) {
                        plain[p + j] = blockOut[j] ^ prev[prevOffset + j];
                    }
                    prev = ciphertext;
                    prevOffset = p;
                }
                var pad = plain[plain.length - 1];
                if (pad > 0 && pad <= 16 && pad <= plain.length) {
                    for (var q = plain.length - pad; q < plain.length; q++) {
                        if (plain[q] !== pad) return plain;
                    }
                    return plain.subarray(0, plain.length - pad);
                }
                return plain;
            }
        };
    })();

    var activeBaseUrl = null;
    var remoteBaseUrlsPromise = null;

    function runtimeBaseUrl() {
        var m = typeof g.manifest !== "undefined" && g.manifest ? g.manifest : {};
        return m.baseUrl;
    }

    function cacheGet(key, ttl) {
        try { return g.cache ? g.cache.get(key, ttl) : null; } catch (e) { return null; }
    }

    function cacheSet(key, value) {
        try { if (g.cache) g.cache.set(key, value); } catch (e) {}
    }

    function errText(error) {
        return error && error.message ? error.message : String(error);
    }

    function trimToString(value) {
        if (value === null || value === undefined) return "";
        return typeof value === "string" ? value.trim() : String(value).trim();
    }

    function extend(target) {
        for (var i = 1; i < arguments.length; i++) {
            var src = arguments[i];
            if (!src || typeof src !== "object") continue;
            var keys = Object.keys(src);
            for (var k = 0; k < keys.length; k++) target[keys[k]] = src[keys[k]];
        }
        return target;
    }

    function mergeHeaders() {
        var out = {};
        for (var i = 0; i < arguments.length; i++) {
            var h = arguments[i];
            if (h && typeof h === "object") extend(out, h);
        }
        return out;
    }

    function isFiniteNumber(n) {
        return typeof n === "number" && isFinite(n);
    }

    function safeJsonParse(text) {
        if (!text) return null;
        try {
            return JSON.parse(String(text));
        } catch (e) {
            return null;
        }
    }

    function normalizeBaseUrl(value) {
        var normalized = trimToString(value).replace(/\/+$/, "");
        if (!normalized || /example\.com/i.test(normalized)) return null;
        if (!/^https?:\/\//i.test(normalized)) return null;
        return normalized;
    }

    function extractResponseBody(response) {
        if (!response) return "";
        if (typeof response === "string") return response;
        if (typeof response.body === "string") return response.body;
        return "";
    }

    function extractResponseStatus(response) {
        if (!response) return 200;
        return typeof response.status !== "undefined" ? response.status : 200;
    }

    function createAppInstanceId() {
        var value = "";
        while (value.length < 32) {
            value += Math.random().toString(16).slice(2);
        }
        return value.slice(0, 32);
    }

    function b64ToBytes(value) {
        var normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/").replace(/\s+/g, "");
        while (normalized.length % 4) normalized += "=";
        var decoded = typeof atob === "function" ? atob(normalized) : "";
        var bytes = new Uint8Array(decoded.length);
        for (var index = 0; index < decoded.length; index++) {
            bytes[index] = decoded.charCodeAt(index) & 255;
        }
        return bytes;
    }

    function bytesToAscii(bytes) {
        var out = "";
        for (var index = 0; index < bytes.length; index++) {
            out += String.fromCharCode(bytes[index]);
        }
        return out;
    }

    function utf8Decode(bytes) {
        if (!bytes || !bytes.length) return "";
        var out = [];
        var i = 0;
        var n = bytes.length;
        if (n >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) i = 3;
        while (i < n) {
            var c = bytes[i++];
            var cp;
            var extra;
            if (c < 0x80) { out.push(String.fromCharCode(c)); continue; }
            if (c >= 0xC2 && c < 0xE0) { cp = c & 0x1F; extra = 1; }
            else if (c >= 0xE0 && c < 0xF0) { cp = c & 0x0F; extra = 2; }
            else if (c >= 0xF0 && c < 0xF5) { cp = c & 0x07; extra = 3; }
            else { out.push("\uFFFD"); continue; }
            var ok = i + extra <= n;
            for (var k = 0; ok && k < extra; k++) {
                var cc = bytes[i + k];
                if ((cc & 0xC0) !== 0x80) { ok = false; break; }
                cp = (cp << 6) | (cc & 0x3F);
            }
            if (!ok) { out.push("\uFFFD"); continue; }
            i += extra;
            if (cp > 0xFFFF) {
                cp -= 0x10000;
                out.push(String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF)));
            } else {
                out.push(String.fromCharCode(cp));
            }
        }
        return out.join("");
    }

    function reverseBytes(bytes) {
        var out = new Uint8Array(bytes.length);
        for (var i = 0; i < bytes.length; i++) out[i] = bytes[bytes.length - 1 - i];
        return out;
    }

    function swapAdjacentPairs(bytes) {
        var out = new Uint8Array(bytes.length);
        var i;
        for (i = 0; i < bytes.length; i++) out[i] = bytes[i];
        for (i = 0; i + 1 < out.length; i += 2) {
            var tmp = out[i];
            out[i] = out[i + 1];
            out[i + 1] = tmp;
        }
        return out;
    }

    function parseUrl(value) {
        var m = /^([a-zA-Z][a-zA-Z0-9+.\-]*):\/\/([^\/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/.exec(trimToString(value));
        if (!m) return null;
        var authority = m[2];
        var at = authority.lastIndexOf("@");
        var hostPort = at === -1 ? authority : authority.slice(at + 1);
        var host = hostPort;
        var port = "";
        var pm = /^(.*):(\d*)$/.exec(hostPort);
        if (pm && hostPort.charAt(0) !== "[") { host = pm[1]; port = pm[2]; }
        return {
            scheme: m[1].toLowerCase(),
            authority: authority,
            hostname: host.toLowerCase(),
            port: port,
            path: m[3] || "",
            search: m[4] || "",
            hash: m[5] || ""
        };
    }

    function normalizePath(path) {
        var segments = path.split("/");
        var out = [];
        for (var i = 0; i < segments.length; i++) {
            var seg = segments[i];
            var last = i === segments.length - 1;
            if (seg === "..") {
                if (out.length > 1) out.pop();
                if (last) out.push("");
            } else if (seg === ".") {
                if (last) out.push("");
            } else {
                out.push(seg);
            }
        }
        var joined = out.join("/");
        return joined.charAt(0) === "/" ? joined : "/" + joined;
    }

    function formatUrl(p) {
        var authority = p.authority.slice(0, p.authority.length - (p.port ? p.port.length + 1 : 0));
        var at = authority.lastIndexOf("@");
        var userinfo = at === -1 ? "" : authority.slice(0, at + 1);
        var defaultPort = (p.scheme === "http" && p.port === "80") || (p.scheme === "https" && p.port === "443");
        var host = userinfo + p.hostname + (p.port && !defaultPort ? ":" + p.port : "");
        return p.scheme + "://" + host + (p.path || "/") + p.search + p.hash;
    }

    function resolveUrl(relative, base) {
        var target = trimToString(relative);
        var b = parseUrl(base);
        if (!b) return null;
        var abs = parseUrl(target);
        if (abs) {
            abs.path = normalizePath(abs.path || "/");
            return formatUrl(abs);
        }
        if (/^[a-zA-Z][a-zA-Z0-9+.\-]*:/.test(target)) return null;
        var out = {
            scheme: b.scheme,
            authority: b.authority,
            hostname: b.hostname,
            port: b.port,
            path: b.path,
            search: b.search,
            hash: ""
        };
        if (target.indexOf("//") === 0) {
            var net = parseUrl(b.scheme + ":" + target);
            if (!net) return null;
            net.path = normalizePath(net.path || "/");
            return formatUrl(net);
        }
        var hashAt = target.indexOf("#");
        var frag = "";
        if (hashAt !== -1) { frag = target.slice(hashAt); target = target.slice(0, hashAt); }
        var queryAt = target.indexOf("?");
        var query = null;
        if (queryAt !== -1) { query = target.slice(queryAt); target = target.slice(0, queryAt); }
        if (target === "") {
            if (query !== null) out.search = query;
        } else if (target.charAt(0) === "/") {
            out.path = normalizePath(target);
            out.search = query === null ? "" : query;
        } else {
            var dir = b.path.slice(0, b.path.lastIndexOf("/") + 1) || "/";
            out.path = normalizePath(dir + target);
            out.search = query === null ? "" : query;
        }
        out.hash = frag;
        if (!out.path) out.path = "/";
        return formatUrl(out);
    }

    function hostOf(value) {
        var p = parseUrl(value);
        return p ? p.hostname : "";
    }

    function withTimeout(promise, ms, fallback) {
        return new Promise(function (resolve) {
            var done = false;
            var timer = setTimeout(function () {
                if (!done) { done = true; resolve(fallback); }
            }, ms);
            Promise.resolve(promise).then(function (value) {
                if (!done) { done = true; clearTimeout(timer); resolve(value); }
            }, function () {
                if (!done) { done = true; clearTimeout(timer); resolve(fallback); }
            });
        });
    }

    function request(url, init, timeoutMs) {
        var pending = fetch(url, init).then(function (response) {
            return response.text().then(function (text) {
                return { status: response.status, body: text };
            });
        });
        return withTimeout(pending, timeoutMs, { status: 0, body: "" });
    }

    function fetchText(url, headers, timeoutMs) {
        if (!url || typeof url !== "string") return Promise.reject(new Error("Invalid URL for fetchText"));
        return request(url, { headers: headers || {} }, timeoutMs);
    }

    function postText(url, headers, body, timeoutMs) {
        if (!url || typeof url !== "string") return Promise.reject(new Error("Invalid URL for postText"));
        return request(url, { method: "POST", headers: headers || {}, body: body || "" }, timeoutMs);
    }

    function fetchRemoteBaseUrls(timeoutMs) {
        var cached = cacheGet("remote_base_urls", BASE_URL_TTL);
        if (Array.isArray(cached) && cached.length) return Promise.resolve(cached);
        if (remoteBaseUrlsPromise) return remoteBaseUrlsPromise;

        var endpoint = "https://firebaseremoteconfig.googleapis.com/v1/projects/" + FIREBASE_CONFIG.projectNumber + "/namespaces/firebase:fetch";
        var payload = {
            appInstanceId: createAppInstanceId(),
            appInstanceIdToken: "",
            appId: FIREBASE_CONFIG.appId,
            countryCode: "US",
            languageCode: "en-US",
            platformVersion: "30",
            timeZone: "UTC",
            appVersion: FIREBASE_CONFIG.appVersion,
            appBuild: FIREBASE_CONFIG.appBuild,
            packageName: FIREBASE_CONFIG.packageName,
            sdkVersion: FIREBASE_CONFIG.sdkVersion,
            analyticsUserProperties: {}
        };
        var headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-Android-Package": FIREBASE_CONFIG.packageName,
            "X-Goog-Api-Key": FIREBASE_CONFIG.apiKey,
            "X-Google-GFE-Can-Retry": "yes",
            "User-Agent": "okhttp/4.12.0"
        };

        remoteBaseUrlsPromise = postText(endpoint, headers, JSON.stringify(payload), timeoutMs).then(function (response) {
            var status = extractResponseStatus(response);
            if (status >= 400 || status === 0) return [];
            var data = safeJsonParse(extractResponseBody(response));
            var entries = data && data.entries ? data.entries : {};
            var urls = [];
            var normalized = normalizeBaseUrl(entries.api_url);
            if (normalized) urls.push(normalized);
            if (urls.length) cacheSet("remote_base_urls", urls);
            return urls;
        }).then(null, function () {
            return [];
        });
        return remoteBaseUrlsPromise;
    }

    function buildPlayzHeaders() {
        return {
            "User-Agent": "Dalvik/2.1.0 (Linux; U; Android 10; SM-A505F)"
        };
    }

    function startsJson(text) {
        var c = text.charAt(0);
        return c === "{" || c === "[";
    }

    function decryptPayload(body) {
        var raw = trimToString(body);
        if (!raw) return "";
        var first = raw.charAt(0);
        if (first === "{" || first === "[" || first === "<") return raw;
        var stripped = raw.replace(/\s+/g, "");

        try {
            var b1 = b64ToBytes(stripped);
            var b2 = swapAdjacentPairs(reverseBytes(b1));
            var b2Str = bytesToAscii(b2).replace(/\s+/g, "");
            var b3 = b64ToBytes(b2Str);
            var text1 = utf8Decode(AES.decryptCbc(b3, NATIVE_KEY, NATIVE_IV)).trim();
            if (startsJson(text1)) return text1;
        } catch (e1) {}

        try {
            var restored = "";
            for (var i = 0; i < stripped.length; i++) {
                var ch = stripped.charAt(i);
                restored += SUBSTITUTION_REVERSE[ch] || ch;
            }
            var inner = bytesToAscii(b64ToBytes(restored));
            var text2 = utf8Decode(AES.decryptCbc(b64ToBytes(inner), PRIMARY_KEY, PRIMARY_IV)).trim();
            if (startsJson(text2)) return text2;
        } catch (e2) {}

        try {
            var text3 = utf8Decode(AES.decryptCbc(b64ToBytes(stripped), FALLBACK_KEY, FALLBACK_IV)).trim();
            if (startsJson(text3)) return text3;
        } catch (e3) {}

        return "";
    }

    function fetchPayload(url, timeoutMs) {
        if (!url || typeof url !== "string") return Promise.resolve("");
        return fetchText(url, buildPlayzHeaders(), timeoutMs).then(function (response) {
            var status = extractResponseStatus(response);
            if (status < 200 || status >= 300) return "";
            return decryptPayload(extractResponseBody(response));
        }).then(null, function () {
            return "";
        });
    }

    function fetchPlayzJson(path, timeoutMs) {
        if (!path || typeof path !== "string") return Promise.resolve(null);

        function attempt(baseUrl) {
            var finalUrl = /^https?:\/\//i.test(path) ? path : baseUrl + "/" + String(path).replace(/^\/+/, "");
            return fetchPayload(finalUrl, timeoutMs).then(function (text) {
                var data = safeJsonParse(text);
                if (data) {
                    activeBaseUrl = normalizeBaseUrl(baseUrl);
                    cacheSet("active_base_url", activeBaseUrl);
                    return data;
                }
                return null;
            });
        }

        function race(urls) {
            return new Promise(function (resolve) {
                var pending = urls.length;
                if (!pending) { resolve(null); return; }
                urls.forEach(function (u) {
                    Promise.resolve().then(function () { return attempt(u); }).then(function (data) {
                        if (data) resolve(data);
                        else if (--pending === 0) resolve(null);
                    }, function () {
                        if (--pending === 0) resolve(null);
                    });
                });
            });
        }

        var first = [];
        function add(value) {
            var n = normalizeBaseUrl(value);
            if (n && first.indexOf(n) === -1) first.push(n);
        }
        add(activeBaseUrl);
        add(cacheGet("active_base_url", BASE_URL_TTL));
        add(runtimeBaseUrl());
        DEFAULT_BASE_URLS.forEach(add);

        var remote = fetchRemoteBaseUrls(timeoutMs).then(null, function () { return []; });
        return race(first).then(function (data) {
            if (data) return data;
            return remote.then(function (urls) {
                var extra = [];
                (urls || []).forEach(function (u) {
                    var n = normalizeBaseUrl(u);
                    if (n && first.indexOf(n) === -1 && extra.indexOf(n) === -1) extra.push(n);
                });
                return race(extra);
            });
        });
    }

    function mapWithConcurrency(items, limit, worker) {
        var results = new Array(items.length);
        var index = 0;
        function next() {
            if (index >= items.length) return Promise.resolve();
            var idx = index++;
            return Promise.resolve().then(function () {
                return worker(items[idx], idx);
            }).then(function (value) {
                results[idx] = value;
            }, function () {
                results[idx] = null;
            }).then(next);
        }
        var workers = [];
        var count = Math.max(1, Math.min(limit, items.length));
        for (var i = 0; i < count; i++) workers.push(next());
        return Promise.all(workers).then(function () { return results; });
    }

    g.PlayzCore = {
        trimToString: trimToString,
        errText: errText,
        extend: extend,
        mergeHeaders: mergeHeaders,
        isFiniteNumber: isFiniteNumber,
        safeJsonParse: safeJsonParse,
        cacheGet: cacheGet,
        cacheSet: cacheSet,
        extractResponseBody: extractResponseBody,
        extractResponseStatus: extractResponseStatus,
        b64ToBytes: b64ToBytes,
        utf8Decode: utf8Decode,
        parseUrl: parseUrl,
        resolveUrl: resolveUrl,
        hostOf: hostOf,
        withTimeout: withTimeout,
        fetchText: fetchText,
        postText: postText,
        decryptPayload: decryptPayload,
        fetchPlayzJson: fetchPlayzJson,
        mapWithConcurrency: mapWithConcurrency
    };
})(this);
