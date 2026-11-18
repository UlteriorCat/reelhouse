import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHash, matchRoute, href, hrefTitle, hrefWatch } from '../public/js/router.js';

const m = (h) => matchRoute(parseHash(h));
test('router: valid routes', () => {
  assert.deepEqual(m('').name, 'home'); assert.equal(m('#/').name, 'home');
  assert.deepEqual([m('#/search?q=the%20matrix').name, m('#/search?q=the%20matrix').query.get('q')], ['search', 'the matrix']);
  assert.deepEqual(m('#/movie/603'), { name: 'details', params: { type: 'movie', id: '603' }, query: new URLSearchParams() });
  assert.equal(m('#/tv/1396?s=2').query.get('s'), '2');
  assert.deepEqual(m('#/watch/movie/603').params, { type: 'movie', id: '603' });
  assert.deepEqual(m('#/watch/tv/1396/2/5').params, { type: 'tv', id: '1396', season: 2, episode: 5 });
  assert.equal(m('#/list').name, 'list');
});
test('router: rejects malformed / hostile paths', () => {
  for (const h of ['#/movie/abc', '#/movie/1/extra', '#/watch/tv/1396/x/2', '#/watch/tv/1396/1', '#/watch/anime/1', '#/movie/../../etc', '#/movie/12345678901', '#/unknown', '#/movie/%E0%A4%A']) assert.equal(m(h).name, 'notfound', h);
});
test('router: href builders round-trip', () => {
  assert.equal(hrefTitle('tv', 5), '#/tv/5'); assert.equal(hrefWatch('movie', 7), '#/watch/movie/7'); assert.equal(hrefWatch('tv', 7, 2, 3), '#/watch/tv/7/2/3');
  assert.equal(href('/search', { q: 'a b&c' }), '#/search?q=a+b%26c'); assert.equal(m(href('/search', { q: 'a b&c' })).query.get('q'), 'a b&c');
  assert.equal(m(hrefWatch('tv', 7, 2, 3)).params.episode, 3);
});
