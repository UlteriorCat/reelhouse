// Small helpers shared by the E2E step files.
import { waitFor, sleep } from './lib.mjs';

export const video = (page, fn, ...args) => page.evaluate((src, a) => { const v = document.querySelector('video'); return v ? new Function('v', 'a', 'return (' + src + ')(v, a)')(v, a) : null; }, fn.toString(), args);
export const currentFile = (page) => video(page, (v) => { const u = new URL(v.currentSrc); return decodeURIComponent(u.searchParams.get('u') || u.pathname).split('/').pop(); }); // gateway URLs carry the real file in ?u=
export const waitPlaying = (page, min = 1.0, timeout = 25000) => waitFor(() => video(page, (v, m) => v.currentTime > m && !v.paused && v.videoWidth > 0, min), { timeout, interval: 80, what: `video playing past ${min}s` });
export const text = (page, sel) => page.$eval(sel, (e) => e.textContent.trim());
export const hasText = (page, sel, re) => page.evaluate((s, r) => [...document.querySelectorAll(s)].some((e) => new RegExp(r, 'i').test(e.textContent)), sel, re.source);
export const clickByText = (page, sel, re) => page.evaluate((s, r) => { const el = [...document.querySelectorAll(s)].find((e) => new RegExp(r, 'i').test(e.textContent)); if (!el) throw new Error(`no ${s} matching ${r}`); el.click(); }, sel, re.source);

/** Opens the "Sources" sheet on the watch page and plays the ticket whose file name matches. */
export async function pickSource(page, nameRe) {
  await clickByText(page, '.toolrow .btn', /Sources/);
  await page.waitForSelector('dialog.sheet[open] .ticket');
  await page.evaluate((r) => {
    const t = [...document.querySelectorAll('dialog.sheet .ticket')].find((x) => new RegExp(r).test(x.querySelector('.name').textContent));
    if (!t) throw new Error('no ticket matching ' + r);
    t.querySelector('.btn').click();
  }, nameRe.source);
  await waitFor(async () => !(await page.$('dialog.sheet[open]')), { what: 'sheet closing after pick' });
}

export const artPanelOpen = async (page) => { if (!(await page.$('.art-setting-panel.art-current'))) { await page.evaluate(() => document.querySelector('.art-control-setting').click()); await sleep(200); } };
export async function artRange(page, label, value) {
  await artPanelOpen(page);
  await page.evaluate((l, v) => {
    const item = [...document.querySelectorAll('.art-setting-item')].find((i) => i.textContent.trim().startsWith(l));
    const r = item.querySelector('input[type=range]');
    r.value = String(v); r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true }));
  }, label, value);
  await sleep(200);
}
export async function artSelect(page, label, option) {
  await artPanelOpen(page);
  await page.evaluate((l) => { [...document.querySelectorAll('.art-setting-item')].find((i) => i.textContent.trim().startsWith(l)).click(); }, label);
  await sleep(200);
  await page.evaluate((o) => { const el = [...document.querySelectorAll('.art-setting-item')].find((i) => i.textContent.trim() === o || i.textContent.trim().startsWith(o)); if (!el) throw new Error('no option ' + o); el.click(); }, option);
  await sleep(250);
}
export const subText = (page) => page.evaluate(() => [...document.querySelectorAll('.art-subtitle-line')].map((l) => l.textContent.trim()).join(' | '));
export const subStyle = (page) => page.evaluate(() => { const s = document.querySelector('.art-subtitle'); const c = getComputedStyle(s); const line = document.querySelector('.art-subtitle-line'); return { size: parseFloat(c.fontSize), color: c.color, bottom: Math.round(innerHeight - s.getBoundingClientRect().bottom), lineBg: line ? getComputedStyle(line).backgroundColor : '', shadow: c.textShadow }; });
export const settings = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('rh:settings') || '{}'));
