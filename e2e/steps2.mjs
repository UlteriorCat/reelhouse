import { video, currentFile, waitPlaying, text, hasText, clickByText, pickSource, artRange, artSelect, subText, subStyle, settings } from './helpers.mjs';
import { steps3 } from './steps3.mjs';

export async function steps2(ctx) {
  const { step, assert, b, bdix, open, waitFor, sleep, shot } = ctx;

  await step('play: clicking Play starts the BDIX lookup, picks the best PLAYABLE source, plays with sound, records history', async () => {
    const page = await b.newPage({ width: 1280, height: 800, label: 'play' });
    await open(page, '#/movie/603');
    await waitFor(() => page.$('.dinfo h1'), { what: 'details' });
    bdix.log.length = 0;
    await sleep(300);
    assert.equal(bdix.log.length, 0);
    await page.click('.dinfo .btn.primary');
    await waitPlaying(page, 1.2);
    assert.equal(await currentFile(page), 'The.Matrix.1999.1080p.WEB-DL.x264.AAC.mp4', 'default = 1080p H.264 AAC mp4, not the 2160p HEVC file');
    const v = await video(page, (v) => ({ w: v.videoWidth, audio: v.webkitAudioDecodedByteCount, rs: v.readyState }));
    assert.equal(v.w, 640); assert.ok(v.audio > 0, 'audio is actually being decoded'); assert.ok(v.rs >= 3);
    assert.equal(await page.$$eval('.banner', (e) => e.length), 0, 'no warning banner for a healthy source');
    assert.equal(bdix.log.filter((r) => r.method === 'POST').length, 4);
    const hist = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('rh:library')).history));
    assert.equal(hist[0].id, 603); assert.equal(hist[0].title, 'The Matrix');
    assert.equal(await text(page, '.watch-top h1'), 'The Matrix1999');
    await shot(page, 'watch-desktop');
    assert.deepEqual(await b.cspViolations(page), []);
    await page.close();
  });

  await step('resume + continue watching: position saved on pause, restored after reload, shown on home and in episode list', async () => {
    const page = await b.newPage({ width: 1280, height: 800, label: 'resume' });
    await open(page, '#/watch/tv/1396/1/2');
    await waitPlaying(page, 0.8);
    assert.equal(await currentFile(page), 'Breaking.Bad.S01E02.720p.WEB-DL.x264.AAC.mp4');
    await video(page, (v) => { v.currentTime = 60; });
    await waitFor(() => video(page, (v) => v.currentTime >= 60 && v.readyState >= 3), { what: 'seek to 60s' });
    await video(page, (v) => v.pause());
    await waitFor(async () => (await page.evaluate(() => JSON.parse(localStorage.getItem('rh:progress') || '{}')['tv:1396:1:2']))?.pos >= 59, { what: 'progress saved on pause' });
    await open(page, '#/');
    await waitFor(() => page.$('.rail[data-rail=continue] .card'), { what: 'continue watching row' });
    const c = await page.$eval('.rail[data-rail=continue] .card-wrap', (w) => ({ title: w.querySelector('.t').textContent, label: w.querySelector('.y').textContent, pct: parseInt(w.querySelector('.bar i').style.width, 10), resume: w.querySelector('.resume').getAttribute('href') }));
    assert.equal(c.title, 'Breaking Bad'); assert.equal(c.label, 'S1 E2'); assert.ok(c.pct >= 38 && c.pct <= 42, `progress bar ~40%, got ${c.pct}`); assert.equal(c.resume, '#/watch/tv/1396/1/2');
    await open(page, '#/tv/1396');
    await waitFor(() => page.$('.ep'), { what: 'episodes' });
    assert.ok(parseInt(await page.$eval('.ep[data-episode="2"] .bar i', (i) => i.style.width), 10) >= 38, 'episode row shows progress');
    assert.ok((await text(page, '.dinfo .btn.primary')).includes('Continue S1 E2'), 'Play button continues the last episode');
    await open(page, '#/watch/tv/1396/1/2');
    await waitPlaying(page, 59.2);
    const t = await video(page, (v) => v.currentTime);
    assert.ok(t >= 59 && t < 70, `resumed near 60s, at ${t}`);
    await page.close();
  });

  await step('next episode: control present; episode end auto-advances (autoplay next)', async () => {
    const page = await b.newPage({ width: 1280, height: 800, label: 'next' });
    await open(page, '#/watch/tv/1396/1/2');
    await waitPlaying(page, 0.8);
    assert.ok(await hasText(page, '.art-control', /Next episode/), 'Next episode control');
    await video(page, (v) => { v.currentTime = v.duration - 1.2; });
    await waitFor(async () => (await page.evaluate(() => location.hash)) === '#/watch/tv/1396/1/3', { timeout: 20000, what: 'auto-advance to episode 3' });
    await waitPlaying(page, 0.5);
    assert.equal(await currentFile(page), 'Breaking.Bad.S01E03.720p.WEB-DL.x264.AAC.mp4');
    assert.ok((await text(page, '.watch-top h1')).includes('Season 1, Episode 3'));
    await page.close();
  });

  await step('health: an HEVC source is detected (0x0 video, no error) and the player falls back to a playable one automatically', async () => {
    const page = await b.newPage({ width: 1280, height: 800, label: 'hevc' });
    await open(page, '#/watch/movie/603');
    await waitPlaying(page, 0.8);
    await pickSource(page, /2160p.*x265/);
    await waitFor(async () => /Trying another source/.test(await text(page, '#toasts')), { timeout: 15000, what: 'fallback toast' });
    await waitFor(async () => { const f = await currentFile(page); return f && !/x265/.test(f); }, { timeout: 15000, what: 'switched away from HEVC' });
    await waitPlaying(page, 0.8);
    assert.equal(await page.$$eval('.banner', (e) => e.length), 0);
    await page.close();
  });

  await step('health: AC-3/DD+ audio is detected as silent; banner offers a working alternative', async () => {
    const page = await b.newPage({ width: 1280, height: 800, label: 'ac3' });
    await open(page, '#/watch/movie/603');
    await waitPlaying(page, 0.8);
    await pickSource(page, /DDP5\.1/);
    await waitFor(() => page.$('.banner'), { timeout: 20000, what: 'no-sound banner' });
    assert.match(await text(page, '.banner h3'), /No sound/);
    assert.equal(await currentFile(page), 'The.Matrix.1999.1080p.BluRay.x264.DDP5.1.mkv');
    assert.equal(await video(page, (v) => v.webkitAudioDecodedByteCount), 0, 'confirms the file really is silent in this browser');
    await shot(page, 'watch-banner-ac3');
    await clickByText(page, '.banner .btn', /Try another source/);
    await waitFor(async () => !(await page.$('.banner')), { what: 'banner cleared' });
    await waitFor(async () => (await currentFile(page)) !== 'The.Matrix.1999.1080p.BluRay.x264.DDP5.1.mkv', { what: 'source switched' });
    await waitPlaying(page, 3.0);
    assert.ok((await video(page, (v) => v.webkitAudioDecodedByteCount)) > 0, 'alternative has working audio');
    await page.close();
  });

  await step('MOV and MKV (H.264/AAC) play in the player even though the server sends application/octet-stream', async () => {
    const page = await b.newPage({ width: 1280, height: 800, label: 'containers' });
    await open(page, '#/watch/movie/603');
    await waitPlaying(page, 0.8);
    for (const [re, name] of [[/720p.*\.mov$/, 'The.Matrix.1999.720p.WEB-DL.x264.AAC.mov'], [/720p.*\.mkv$/, 'The.Matrix.1999.720p.WEB-DL.x264.AAC.mkv']]) {
      await pickSource(page, re);
      await waitFor(async () => (await currentFile(page)) === name, { what: 'switch to ' + name });
      await waitPlaying(page, 1.0);
      const v = await video(page, (v) => ({ w: v.videoWidth, audio: v.webkitAudioDecodedByteCount }));
      assert.equal(v.w, 640); assert.ok(v.audio > 0, name + ' has audio');
    }
    assert.equal(await page.$$eval('.banner', (e) => e.length), 0);
    await page.close();
  });

  await step('subtitles: auto-loaded (Latin-1 decoded), size/height/color/background apply + persist, language search, file upload, Off', async () => {
    const page = await b.newPage({ width: 1280, height: 800, label: 'subs' });
    await open(page, '#/watch/movie/603');
    await waitPlaying(page, 0.8);
    await waitFor(async () => /Hello from the test subtitle/.test(await subText(page)), { timeout: 15000, what: 'auto subtitle' });
    assert.ok((await subText(page)).includes('Caf\u00e9 au lait'), 'Latin-1 bytes decoded to \u00e9');
    const base = await subStyle(page);
    await artRange(page, 'Subtitle size', 200);
    const big = await subStyle(page);
    assert.ok(big.size > base.size * 1.8 && big.size < base.size * 2.2, `size doubled: ${base.size} -> ${big.size}`);
    await artRange(page, 'Subtitle height', 20);
    const high = await subStyle(page);
    assert.ok(high.bottom > big.bottom + 40, `moved up: ${big.bottom} -> ${high.bottom}`);
    await artSelect(page, 'Subtitle color', 'Yellow');
    assert.equal((await subStyle(page)).color, 'rgb(255, 224, 102)');
    await artSelect(page, 'Subtitle background', 'Box');
    const box = await subStyle(page);
    assert.match(box.lineBg, /rgba\(0, 0, 0, 0\.72\)/); assert.equal(box.shadow, 'none');
    await shot(page, 'watch-subtitle-box');
    const saved = (await settings(page)).subStyle;
    assert.deepEqual([saved.size, saved.bottom, saved.color, saved.bg], [200, 20, '#ffe066', 'box'], 'preferences persisted');
    await artSelect(page, 'Subtitle background', 'None');
    assert.equal((await subStyle(page)).lineBg, 'rgba(0, 0, 0, 0)');
    // language search (Bengali, UTF-8) through the Subtitles sheet
    await clickByText(page, '.toolrow .btn', /Subtitles/);
    await page.waitForSelector('dialog.sheet[open] select');
    await page.select('dialog.sheet[open] select', 'bn');
    await clickByText(page, 'dialog.sheet .btn', /^Search$/);
    await waitFor(() => page.$('dialog.sheet .sheet-body > .stack:nth-child(2) > button.btn'), { what: 'bn results' });
    await page.evaluate(() => document.querySelector('dialog.sheet .sheet-body > .stack:nth-child(2) > button.btn').click());
    await waitFor(async () => /Subtitles loaded/.test(await text(page, '#toasts')), { what: 'loaded toast' });
    await waitFor(async () => /\u09b8\u09cd\u09ac\u09be\u0997\u09a4\u09ae/.test(await subText(page)), { what: 'Bengali text shown' });
    // upload a file from the device
    await clickByText(page, '.toolrow .btn', /Subtitles/);
    await page.waitForSelector('dialog.sheet[open] #subfile');
    await (await page.$('dialog.sheet[open] #subfile')).uploadFile(new URL('./fixtures/upload.srt', import.meta.url).pathname);
    await waitFor(async () => /Uploaded subtitle line/.test(await subText(page)), { what: 'uploaded subtitle shown' });
    // the player lists everything and can switch Off
    await artSelect(page, 'Subtitles', 'Off');
    await waitFor(async () => !(await page.$eval('.art-video-player', (e) => e.classList.contains('art-subtitle-show'))), { what: 'subtitles hidden' });
    await page.close();
  });

  await steps3(ctx);
}
