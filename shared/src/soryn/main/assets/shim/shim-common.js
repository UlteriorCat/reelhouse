(function (g) {
  'use strict';

  var H = g.Host;

  g.global = g;
  g.self = g;
  if (typeof g.globalThis === 'undefined') g.globalThis = g;

  g.console = {};
  ['log', 'info', 'warn', 'error', 'debug'].forEach(function (k) { g.console[k] = function () {}; });

  var jobs = [];
  if (typeof g.Promise === 'undefined') {
    var PENDING = 0, FULFILLED = 1, REJECTED = 2;
    var enqueue = function (fn) { jobs.push(fn); };
    var Promise_ = function (executor) {
      if (!(this instanceof Promise_)) throw new TypeError('Promise must be called with new');
      var self = this;
      self._state = PENDING;
      self._value = undefined;
      self._handlers = [];
      var called = false;
      function settle(state, value) {
        if (self._state !== PENDING) return;
        self._state = state;
        self._value = value;
        var hs = self._handlers;
        self._handlers = [];
        for (var i = 0; i < hs.length; i++) schedule(hs[i]);
      }
      function resolve(x) {
        if (called) return;
        called = true;
        resolveValue(x);
      }
      function resolveValue(x) {
        if (x === self) { settle(REJECTED, new TypeError('Promise resolved with itself')); return; }
        if (x !== null && (typeof x === 'object' || typeof x === 'function')) {
          var then;
          try { then = x.then; } catch (e) { settle(REJECTED, e); return; }
          if (typeof then === 'function') {
            var once = false;
            enqueue(function () {
              try {
                then.call(x,
                  function (y) { if (once) return; once = true; resolveValue(y); },
                  function (r) { if (once) return; once = true; settle(REJECTED, r); });
              } catch (e) { if (!once) { once = true; settle(REJECTED, e); } }
            });
            return;
          }
        }
        settle(FULFILLED, x);
      }
      function reject(r) {
        if (called) return;
        called = true;
        settle(REJECTED, r);
      }
      function schedule(h) { enqueue(function () { run(h); }); }
      self._schedule = function (h) {
        if (self._state === PENDING) self._handlers.push(h); else schedule(h);
      };
      function run(h) {
        var cb = self._state === FULFILLED ? h.onFulfilled : h.onRejected;
        if (typeof cb !== 'function') {
          if (self._state === FULFILLED) h.resolve(self._value); else h.reject(self._value);
          return;
        }
        var out;
        try { out = cb(self._value); } catch (e) { h.reject(e); return; }
        h.resolve(out);
      }
      try { executor(resolve, reject); } catch (e) { reject(e); }
    }
    Promise_.prototype.then = function (onFulfilled, onRejected) {
      var parent = this;
      return new Promise_(function (resolve, reject) {
        parent._schedule({ onFulfilled: onFulfilled, onRejected: onRejected, resolve: resolve, reject: reject });
      });
    };
    Promise_.prototype['catch'] = function (onRejected) { return this.then(undefined, onRejected); };
    Promise_.prototype['finally'] = function (fn) {
      return this.then(
        function (v) { return Promise_.resolve(fn()).then(function () { return v; }); },
        function (r) { return Promise_.resolve(fn()).then(function () { throw r; }); });
    };
    Promise_.resolve = function (v) {
      if (v instanceof Promise_) return v;
      return new Promise_(function (res) { res(v); });
    };
    Promise_.reject = function (r) { return new Promise_(function (_, rej) { rej(r); }); };
    Promise_.all = function (list) {
      return new Promise_(function (resolve, reject) {
        var items = [];
        for (var k = 0; k < list.length; k++) items.push(list[k]);
        var n = items.length, out = new Array(n), left = n;
        if (n === 0) { resolve(out); return; }
        items.forEach(function (it, i) {
          Promise_.resolve(it).then(function (v) {
            out[i] = v;
            if (--left === 0) resolve(out);
          }, reject);
        });
      });
    };
    Promise_.race = function (list) {
      return new Promise_(function (resolve, reject) {
        for (var i = 0; i < list.length; i++) Promise_.resolve(list[i]).then(resolve, reject);
      });
    };
    Promise_.allSettled = function (list) {
      return Promise_.all(Array.prototype.map.call(list, function (p) {
        return Promise_.resolve(p).then(
          function (v) { return { status: 'fulfilled', value: v }; },
          function (r) { return { status: 'rejected', reason: r }; });
      }));
    };
    g.Promise = Promise_;
  }

  g.__drainMicrotasks = function () {
    var guard = 0;
    while (jobs.length && guard++ < 1000000) {
      var j = jobs.shift();
      j();
    }
  };

  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  var B64REV = {};
  for (var bi = 0; bi < B64.length; bi++) B64REV[B64.charAt(bi)] = bi;

  g.btoa = function (input) {
    var s = String(input), out = '', i = 0;
    for (var k = 0; k < s.length; k++) {
      if (s.charCodeAt(k) > 255) throw new Error('InvalidCharacterError');
    }
    while (i < s.length) {
      var c1 = s.charCodeAt(i++), c2 = s.charCodeAt(i++), c3 = s.charCodeAt(i++);
      var e1 = c1 >> 2;
      var e2 = ((c1 & 3) << 4) | (c2 >> 4);
      var e3 = ((c2 & 15) << 2) | (c3 >> 6);
      var e4 = c3 & 63;
      if (isNaN(c2)) { e3 = 64; e4 = 64; } else if (isNaN(c3)) { e4 = 64; }
      out += (e1 < 64 ? B64.charAt(e1) : '') + (e2 < 64 ? B64.charAt(e2) : '') +
             (e3 < 64 ? B64.charAt(e3) : '=') + (e4 < 64 ? B64.charAt(e4) : '=');
    }
    return out;
  };

  g.atob = function (input) {
    var s = String(input).replace(/[\t\n\f\r ]+/g, '').replace(/=+$/, '');
    if (s.length % 4 === 1 || /[^A-Za-z0-9+\/]/.test(s)) throw new Error('InvalidCharacterError');
    var out = '', buffer = 0, bits = 0;
    for (var i = 0; i < s.length; i++) {
      buffer = (buffer << 6) | B64REV[s.charAt(i)];
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out += String.fromCharCode((buffer >> bits) & 255);
        buffer = buffer & ((1 << bits) - 1);
      }
    }
    return out;
  };

  function bytesToB64(u8) {
    var s = '';
    for (var i = 0; i < u8.length; i += 4096) {
      var chunk = [];
      for (var j = i; j < i + 4096 && j < u8.length; j++) chunk.push(String.fromCharCode(u8[j]));
      s += chunk.join('');
    }
    return g.btoa(s);
  }

  function b64ToArrayBuffer(b64) {
    try {
      var ab = H.arrayBuffer(b64);
      if (ab) return ab;
    } catch (e) {}
    var bin = g.atob(b64);
    var u8 = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8.buffer;
  }

  var timerSeq = 1, timers = {};
  g.setTimeout = function (fn, ms) {
    var extra = Array.prototype.slice.call(arguments, 2);
    var id = timerSeq++;
    timers[id] = function () { if (typeof fn === 'function') fn.apply(g, extra); };
    H.timer(id, Number(ms) > 0 ? Number(ms) : 0);
    return id;
  };
  g.clearTimeout = function (id) {
    if (timers[id]) { delete timers[id]; H.clearTimer(id); }
  };
  g.__onTimer = function (id) {
    var cb = timers[id];
    if (!cb) return;
    delete timers[id];
    cb();
  };

  function formEncode(v) {
    return encodeURIComponent(String(v)).replace(/%20/g, '+').replace(/[!'()~]/g, function (c) {
      return '%' + c.charCodeAt(0).toString(16).toUpperCase();
    });
  }

  function formDecode(v) {
    try { return decodeURIComponent(String(v).replace(/\+/g, ' ')); } catch (e) { return String(v); }
  }

  g.URLSearchParams = function URLSearchParams(init) {
    var list = [];
    this._list = list;
    if (init === undefined || init === null) return;
    if (init instanceof g.URLSearchParams) {
      init._list.forEach(function (p) { list.push([p[0], p[1]]); });
    } else if (typeof init === 'object') {
      if (Array.isArray(init)) {
        init.forEach(function (p) { list.push([String(p[0]), String(p[1])]); });
      } else {
        Object.keys(init).forEach(function (k) { list.push([k, String(init[k])]); });
      }
    } else {
      var text = String(init);
      if (text.charAt(0) === '?') text = text.slice(1);
      if (text) {
        text.split('&').forEach(function (part) {
          if (!part) return;
          var eq = part.indexOf('=');
          var k = eq < 0 ? part : part.slice(0, eq);
          var v = eq < 0 ? '' : part.slice(eq + 1);
          list.push([formDecode(k), formDecode(v)]);
        });
      }
    }
  };
  g.URLSearchParams.prototype.append = function (k, v) { this._list.push([String(k), String(v)]); };
  g.URLSearchParams.prototype['delete'] = function (k) {
    k = String(k);
    this._list = this._list.filter(function (p) { return p[0] !== k; });
  };
  g.URLSearchParams.prototype.get = function (k) {
    k = String(k);
    for (var i = 0; i < this._list.length; i++) if (this._list[i][0] === k) return this._list[i][1];
    return null;
  };
  g.URLSearchParams.prototype.getAll = function (k) {
    k = String(k);
    return this._list.filter(function (p) { return p[0] === k; }).map(function (p) { return p[1]; });
  };
  g.URLSearchParams.prototype.has = function (k) { return this.get(k) !== null; };
  g.URLSearchParams.prototype.set = function (k, v) {
    k = String(k);
    v = String(v);
    var found = false;
    var next = [];
    this._list.forEach(function (p) {
      if (p[0] !== k) { next.push(p); } else if (!found) { found = true; next.push([k, v]); }
    });
    if (!found) next.push([k, v]);
    this._list = next;
  };
  g.URLSearchParams.prototype.forEach = function (cb) {
    var self = this;
    this._list.slice().forEach(function (p) { cb.call(self, p[1], p[0], self); });
  };
  g.URLSearchParams.prototype.toString = function () {
    return this._list.map(function (p) { return formEncode(p[0]) + '=' + formEncode(p[1]); }).join('&');
  };

  var pending = {}, fetchSeq = 1;

  g.__onFetch = function (id, json) {
    var cb = pending[id];
    if (!cb) return;
    delete pending[id];
    var r = null;
    try { r = JSON.parse(json); } catch (e) { r = null; }
    cb(r);
  };

  function normHeaders(h) {
    var out = {};
    if (!h) return out;
    if (Array.isArray(h)) {
      h.forEach(function (p) { out[String(p[0])] = String(p[1]); });
    } else if (typeof h.forEach === 'function') {
      h.forEach(function (v, k) { out[String(k)] = String(v); });
    } else {
      Object.keys(h).forEach(function (k) { out[k] = String(h[k]); });
    }
    return out;
  }

  function encodeBody(body) {
    if (body === undefined || body === null) return null;
    if (typeof body === 'string') return H.encodeUtf8(body);
    if (g.URLSearchParams && body instanceof g.URLSearchParams) return H.encodeUtf8(body.toString());
    if (typeof ArrayBuffer !== 'undefined') {
      if (body instanceof ArrayBuffer) return bytesToB64(new Uint8Array(body));
      if (ArrayBuffer.isView && ArrayBuffer.isView(body)) {
        return bytesToB64(new Uint8Array(body.buffer, body.byteOffset, body.byteLength));
      }
    }
    return H.encodeUtf8(String(body));
  }

  function makeResponse(r, reqUrl) {
    r = r || { status: 0, statusText: 'bridge error', url: reqUrl, headers: {}, b64: '', charset: 'utf-8', truncated: false };
    var text = null;
    var hdrs = r.headers || {};
    function getText() {
      if (text === null) {
        var t = r.b64 ? H.decode(r.b64, r.charset || 'utf-8') : '';
        text = r.truncated ? t + '\n...[truncated]' : t;
      }
      return text;
    }
    return {
      ok: r.status >= 200 && r.status < 300,
      truncated: !!r.truncated,
      status: r.status,
      statusText: r.statusText || '',
      url: r.url || reqUrl,
      headers: {
        get: function (name) {
          var v = hdrs[String(name).toLowerCase()];
          return v === undefined ? null : v;
        },
        has: function (name) {
          return hdrs[String(name).toLowerCase()] !== undefined;
        },
        forEach: function (cb) {
          Object.keys(hdrs).forEach(function (k) { cb(hdrs[k], k); });
        }
      },
      clone: function () { return makeResponse(r, reqUrl); },
      text: function () { return Promise.resolve(getText()); },
      json: function () {
        try {
          var t = getText();
          return Promise.resolve(t ? JSON.parse(t) : null);
        } catch (e) {
          return Promise.resolve(null);
        }
      },
      arrayBuffer: function () {
        try { return Promise.resolve(b64ToArrayBuffer(r.b64 || '')); }
        catch (e) { return Promise.resolve(new ArrayBuffer(0)); }
      }
    };
  }

  g.fetch = function (input, opts) {
    opts = opts || {};
    var url = (input && typeof input === 'object' && input.url) ? String(input.url) : String(input);
    var method = String(opts.method || (input && input.method) || 'GET').toUpperCase();
    var headers = normHeaders(opts.headers || (input && input.headers));
    var follow = String(opts.redirect || 'follow') !== 'manual';
    var creds = String(opts.credentials || (input && input.credentials) || 'omit') === 'include';
    var body = null;
    try { body = encodeBody(opts.body); } catch (e) { body = null; }
    return new Promise(function (resolve) {
      var id = fetchSeq++;
      pending[id] = function (r) { resolve(makeResponse(r, url)); };
      try {
        H.fetch(id, url, method, JSON.stringify(headers), body === null ? '' : body, body !== null, follow, creds);
      } catch (e) {
        delete pending[id];
        resolve(makeResponse({
          status: 0, statusText: String((e && e.message) || e), url: url,
          headers: {}, b64: '', charset: 'utf-8', truncated: false
        }, url));
      }
    });
  };
})(this);
