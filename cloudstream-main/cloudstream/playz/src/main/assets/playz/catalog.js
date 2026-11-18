var core = globalThis.PlayzCore;
var trimToString = core.trimToString;
var isFiniteNumber = core.isFiniteNumber;
var safeJsonParse = core.safeJsonParse;
var cacheGet = core.cacheGet;
var cacheSet = core.cacheSet;
var errText = core.errText;

var REQUEST_TIMEOUT_MS = 5000;
var EVENTS_TTL = 60000;
var CATEGORY_ORDER = ["Cricket", "Football", "Basketball", "Motorsport", "Tennis", "Boxing"];
var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
var eventsPromise = null;

function parsePlayzUtcDateTime(dateText, timeText) {
    var dateMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimToString(dateText));
    var timeMatch = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/.exec(trimToString(timeText));
    if (!dateMatch || !timeMatch) return NaN;
    return Date.UTC(
        parseInt(dateMatch[3], 10),
        parseInt(dateMatch[2], 10) - 1,
        parseInt(dateMatch[1], 10),
        parseInt(timeMatch[1], 10),
        parseInt(timeMatch[2], 10),
        parseInt(timeMatch[3] || "0", 10)
    );
}

function buildEventStatus(event) {
    if (!event || typeof event !== "object") return "LIVE";
    var now = Date.now();
    var start = parsePlayzUtcDateTime(event.date, event.time);
    var end = parsePlayzUtcDateTime(event.endDate, event.endTime);
    if (isFinite(end) && now >= end) return "ENDED";
    if (isFinite(start) && now >= start) return "LIVE";
    if (isFinite(start) && now < start) return "UPCOMING";
    return "LIVE";
}

function normalizeCategoryName(name) {
    return (trimToString(name) || "Other").replace(/\s+/g, " ").trim();
}

function buildEventTitle(event) {
    if (!event || typeof event !== "object") return "Live Event";
    var teamA = trimToString(event.teamAName);
    var teamB = trimToString(event.teamBName);
    if (teamA && teamB) return teamA === teamB ? teamA : teamA + " vs " + teamB;
    return teamA || trimToString(event.eventName) || "Live Event";
}

function pad2(n) {
    return n < 10 ? "0" + n : String(n);
}

function deviceOffsetMinutes(utcMs) {
    if (typeof globalThis.deviceUtcOffsetMinutes !== "function") return 0;
    var v = Number(globalThis.deviceUtcOffsetMinutes(utcMs));
    return isFinite(v) ? Math.round(v) : 0;
}

function formatEventTime(event) {
    var start = parsePlayzUtcDateTime(event.date, event.time);
    if (!isFinite(start)) return "";
    var offsetMin = deviceOffsetMinutes(start);
    var d = new Date(start + offsetMin * 60000);
    var h = d.getUTCHours();
    var abs = Math.abs(offsetMin);
    var label = offsetMin === 0
        ? "UTC"
        : "UTC" + (offsetMin < 0 ? "-" : "+") + Math.floor(abs / 60) + (abs % 60 ? ":" + pad2(abs % 60) : "");
    return d.getUTCDate() + " " + MONTHS[d.getUTCMonth()] + ", " + (h % 12 || 12) + ":" + pad2(d.getUTCMinutes()) + " " + (h < 12 ? "AM" : "PM") + " \u2022 " + label;
}

function buildEventPoster(event) {
    var status = buildEventStatus(event);
    return "playz-poster:" + encodeURIComponent(JSON.stringify({
        category: normalizeCategoryName(event.category),
        eventName: trimToString(event.eventName),
        teamA: trimToString(event.teamAName),
        teamB: trimToString(event.teamBName),
        flagA: trimToString(event.teamAFlag),
        flagB: trimToString(event.teamBFlag),
        logo: trimToString(event.eventLogo),
        status: status,
        time: status === "LIVE" ? "" : formatEventTime(event)
    }));
}

function parseEventEntry(rawEntry, index) {
    if (!rawEntry) return null;
    var eventObject = rawEntry;
    if (typeof rawEntry === "string") {
        eventObject = safeJsonParse(rawEntry);
    } else if (rawEntry.event) {
        eventObject = typeof rawEntry.event === "string" ? safeJsonParse(rawEntry.event) : rawEntry.event;
    }
    if (!eventObject || typeof eventObject !== "object") return null;
    if (eventObject.visible === false) return null;

    var linksPath = trimToString(eventObject.links);
    if (!linksPath) return null;

    var priority = isFiniteNumber(eventObject.priority) ? eventObject.priority : parseInt(eventObject.priority || "-1", 10);
    return {
        id: index + 1,
        category: normalizeCategoryName(eventObject.category),
        eventName: trimToString(eventObject.eventName),
        eventLogo: trimToString(eventObject.eventLogo),
        teamAName: trimToString(eventObject.teamAName),
        teamBName: trimToString(eventObject.teamBName),
        teamAFlag: trimToString(eventObject.teamAFlag),
        teamBFlag: trimToString(eventObject.teamBFlag),
        linksPath: linksPath,
        slug: linksPath.replace(/\.txt$/i, ""),
        date: trimToString(eventObject.date),
        time: trimToString(eventObject.time),
        endDate: trimToString(eventObject.end_date),
        endTime: trimToString(eventObject.end_time),
        priority: priority,
        linkNames: Array.isArray(eventObject.link_names) ? eventObject.link_names : []
    };
}

function parseEntries(list) {
    return list.map(function (entry, idx) { return parseEventEntry(entry, idx); }).filter(Boolean);
}

function sortEvents(events) {
    var weight = { LIVE: 0, UPCOMING: 1, ENDED: 2 };
    return events.slice().sort(function (left, right) {
        var statusDiff = (weight[buildEventStatus(left)] || 9) - (weight[buildEventStatus(right)] || 9);
        if (statusDiff !== 0) return statusDiff;

        var leftStart = parsePlayzUtcDateTime(left.date, left.time);
        var rightStart = parsePlayzUtcDateTime(right.date, right.time);
        if (isFinite(leftStart) && isFinite(rightStart) && leftStart !== rightStart) return leftStart - rightStart;

        var leftPriority = isFiniteNumber(left.priority) ? left.priority : 9999;
        var rightPriority = isFiniteNumber(right.priority) ? right.priority : 9999;
        if (leftPriority !== rightPriority) return leftPriority - rightPriority;

        return buildEventTitle(left).localeCompare(buildEventTitle(right));
    });
}

function fetchPlayzEvents() {
    var cached = cacheGet("events_data", EVENTS_TTL);
    if (Array.isArray(cached) && cached.length) return Promise.resolve(sortEvents(parseEntries(cached)));
    if (eventsPromise) return eventsPromise;
    eventsPromise = core.fetchPlayzJson("events.txt", REQUEST_TIMEOUT_MS).then(function (data) {
        if (!Array.isArray(data)) return [];
        if (data.length) cacheSet("events_data", data);
        return sortEvents(parseEntries(data));
    }).then(function (events) {
        eventsPromise = null;
        return events;
    }, function () {
        eventsPromise = null;
        return [];
    });
    return eventsPromise;
}

function buildHomeItem(event) {
    return new MultimediaItem({
        title: " ",
        description: trimToString(event.eventName) || "Live Event",
        posterUrl: buildEventPoster(event),
        type: "livestream",
        url: JSON.stringify({
            title: buildEventTitle(event),
            category: event.category,
            eventName: event.eventName,
            eventLogo: event.eventLogo,
            teamAName: event.teamAName,
            teamBName: event.teamBName,
            teamAFlag: event.teamAFlag,
            teamBFlag: event.teamBFlag,
            linksPath: event.linksPath,
            slug: event.slug,
            date: event.date,
            time: event.time,
            endDate: event.endDate,
            endTime: event.endTime,
            linkNames: event.linkNames
        })
    });
}

function categoryRank(title) {
    var clean = title.replace(/^[^\w\s]+\s*/, "").toLowerCase();
    for (var i = 0; i < CATEGORY_ORDER.length; i++) {
        if (clean.indexOf(CATEGORY_ORDER[i].toLowerCase()) !== -1) return i;
    }
    return 99;
}

function homeResult(events) {
    if (!events.length) {
        return { success: false, errorCode: "SITE_OFFLINE", message: "Failed to load events from the available PlayZTV hosts" };
    }
    var categories = {};
    var liveNow = [];
    events.forEach(function (event) {
        if (buildEventStatus(event) === "LIVE") liveNow.push(buildHomeItem(event));
        var title = normalizeCategoryName(event.category);
        (categories[title] = categories[title] || []).push(buildHomeItem(event));
    });

    var ordered = {};
    if (liveNow.length) ordered["Live Now"] = liveNow;
    Object.keys(categories).sort(function (left, right) {
        var diff = categoryRank(left) - categoryRank(right);
        return diff !== 0 ? diff : left.localeCompare(right);
    }).forEach(function (key) { ordered[key] = categories[key]; });
    return { success: true, data: ordered };
}

function getHome(cb) {
    fetchPlayzEvents().then(homeResult).then(null, function (error) {
        return { success: false, errorCode: "PARSE_ERROR", message: errText(error) };
    }).then(cb);
}

function search(query, cb) {
    fetchPlayzEvents().then(function (events) {
        var q = trimToString(query).toLowerCase();
        return {
            success: true,
            data: events.filter(function (event) {
                return [event.category, event.eventName, event.teamAName, event.teamBName]
                    .filter(Boolean).join(" ").toLowerCase().indexOf(q) !== -1;
            }).map(buildHomeItem)
        };
    }).then(null, function () {
        return { success: true, data: [] };
    }).then(cb);
}

function load(urlStr, cb) {
    if (!urlStr || typeof urlStr !== "string") {
        cb({ success: false, errorCode: "INVALID_INPUT", message: "Invalid URL string" });
        return;
    }
    var result;
    try {
        var data = JSON.parse(urlStr);
        if (!data || typeof data !== "object") throw new Error("Invalid event data format");
        var title = data.title || buildEventTitle(data);
        var poster = buildEventPoster(data);
        var time = formatEventTime(data);
        var plotParts = [
            trimToString(data.category) ? "Category: " + data.category : "",
            trimToString(data.eventName) ? "Event: " + data.eventName : "",
            time ? "Time: " + time : "",
            data.linkNames && data.linkNames.length ? "Available Servers: " + data.linkNames.length : ""
        ].filter(Boolean);
        result = {
            success: true,
            data: new MultimediaItem({
                title: title,
                url: urlStr,
                posterUrl: poster,
                description: plotParts.join("<br>"),
                type: "livestream",
                episodes: [
                    new Episode({ name: "Watch Live", season: 1, episode: 1, url: urlStr, posterUrl: poster })
                ]
            })
        };
    } catch (error) {
        result = { success: false, errorCode: "PARSE_ERROR", message: "Invalid event data: " + errText(error) };
    }
    cb(result);
}

globalThis.getHome = getHome;
globalThis.search = search;
globalThis.load = load;
