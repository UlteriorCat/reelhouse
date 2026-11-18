(function (g) {
  'use strict';

  var H = g.Host;
  var meta = {};
  try { meta = JSON.parse(H.meta()); } catch (e) { meta = {}; }

  g.SCRAPER_ID = meta.id || '';
  try { g.SCRAPER_SETTINGS = JSON.parse(H.settings() || '{}'); } catch (e2) { g.SCRAPER_SETTINGS = {}; }
  if (typeof g.TMDB_API_KEY === 'undefined') g.TMDB_API_KEY = H.tmdbKey();

  g.module = { exports: {} };
  g.exports = g.module.exports;

  function pick(name) {
    var m = g.module && g.module.exports;
    return (m && m[name]) || g[name];
  }

  g.__call = function (mode, argsJson) {
    var reported = false;
    function done(v) {
      if (reported) return;
      reported = true;
      var out;
      try { out = JSON.stringify(v === undefined || v === null ? [] : v); } catch (e) { out = '[]'; }
      H.done(out === undefined ? '[]' : out);
    }
    function fail() { done([]); }

    try {
      var fn = pick(mode === 'settings' ? 'onSettings' : 'getStreams');
      if (typeof fn !== 'function') { fail(); return; }
      var result;
      if (mode === 'settings') {
        result = fn();
      } else {
        var a = JSON.parse(argsJson);
        var season = a.season === null || a.season === undefined ? undefined : a.season;
        var episode = a.episode === null || a.episode === undefined ? undefined : a.episode;
        result = fn(a.tmdbId, a.mediaType, season, episode);
      }
      Promise.resolve(result).then(done, fail);
    } catch (e) {
      fail();
    }
  };
})(this);
