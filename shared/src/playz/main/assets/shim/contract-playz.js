(function (g) {
  'use strict';

  var H = g.Host;
  g.globalThis = g;

  var cfg = {};
  try { cfg = JSON.parse(H.settings() || '{}'); } catch (e) { cfg = {}; }
  g.manifest = cfg.manifest || {};

  var cacheIn = cfg.cache || {};
  var cacheOut = {};

  g.cache = {
    get: function (key, ttl) {
      var e = cacheOut[key] || cacheIn[key];
      if (!e || typeof e.t !== 'number') return null;
      if (ttl && Date.now() - e.t > ttl) return null;
      return e.v === undefined ? null : e.v;
    },
    set: function (key, value) {
      cacheOut[key] = { v: value, t: Date.now() };
    }
  };

  function copy(self, o) {
    if (o && typeof o === 'object') {
      Object.keys(o).forEach(function (k) { self[k] = o[k]; });
    }
  }

  g.MultimediaItem = function MultimediaItem(o) {
    copy(this, o);
    if (!this.type) this.type = 'movie';
  };
  g.Episode = function Episode(o) {
    copy(this, o);
    if (this.season === undefined || this.season === null) this.season = 0;
    if (this.episode === undefined || this.episode === null) this.episode = 0;
  };
  g.Actor = function Actor(o) { copy(this, o); };

  g.deviceUtcOffsetMinutes = function (ms) {
    var v = Number(H.tzOffset(Number(ms) || 0));
    return isFinite(v) ? v : 0;
  };

  g.__call = function (mode, argsJson) {
    var finished = false;

    function done(res) {
      if (finished) return;
      finished = true;
      var out;
      try { out = JSON.stringify({ res: res, cache: cacheOut }); } catch (e) { out = '{"res":null,"cache":{}}'; }
      H.done(out);
    }

    function failure(code, e) {
      done({ success: false, errorCode: code, message: String(e && (e.message || e) || e) });
    }

    try {
      var a = JSON.parse(argsJson);
      var fn = g[a.fn];
      if (typeof fn !== 'function') { failure('NO_FUNCTION', a.fn); return; }
      if (a.fn === 'getHome') fn(done);
      else fn(a.arg === null || a.arg === undefined ? '' : String(a.arg), done);
    } catch (e) {
      failure('CALL_ERROR', e);
    }
  };
})(this);
