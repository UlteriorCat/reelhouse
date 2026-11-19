// History removal, named lists, accounts (invite sign-up, sync between devices, sign-out), password change and the
// admin page, in a real browser. Each "device" is its own browser profile (own cookies and localStorage).
import { text, hasText, clickByText } from './helpers.mjs';
import { E2E_ADMIN } from './lib.mjs';

const seedHistory = (page, items) => page.evaluate(async (list) => { const { store } = await import('/js/store.js'); for (const i of list) store.pushHistory(i); }, items);
const ITEMS = [
  { type: 'movie', id: 603, title: 'The Matrix', year: '1999', poster: '/pmatrix.jpg' },
  { type: 'tv', id: 1396, title: 'Breaking Bad', season: 1, episode: 2, poster: '/pbb.jpg' },
  { type: 'movie', id: 5, title: 'Paper Cities', year: '2000', poster: '/p5.jpg' },
];

export async function steps5(ctx) {
  const { step, assert, b, open, waitFor, shot, sleep, app } = ctx;
  const openSettings = async (page) => { await page.evaluate(() => document.dispatchEvent(new CustomEvent('rh:settings'))); await page.waitForSelector('dialog.sheet[open] .set-group'); };
  const topSheet = 'dialog.sheet[open]:last-of-type';
  const fill = async (page, name, value) => { await page.$eval(`${topSheet} input[name="${name}"]`, (e) => { e.value = ''; }); await page.type(`${topSheet} input[name="${name}"]`, value); };
  const submit = (page) => page.click(`${topSheet} button[type=submit]`);
  const toastText = (page) => page.$$eval('.toast', (e) => e.map((x) => x.textContent));
  async function signIn(page, username, password) {
    await openSettings(page);
    await waitFor(() => hasText(page, 'dialog.sheet .set-group h3', /^Account$/), { what: 'account section' });
    await clickByText(page, 'dialog.sheet .set-group button', /^Sign in$/);
    await page.waitForSelector(`${topSheet} input[name=username]`);
    await fill(page, 'username', username); await fill(page, 'password', password);
    await submit(page);
    await waitFor(async () => (await toastText(page)).some((t) => t.startsWith('Signed in as')), { what: 'signed in' });
  }
  const closeSheets = async (page) => { for (let i = 0; i < 3 && (await page.$('dialog.sheet[open]')); i++) { await page.keyboard.press('Escape'); await sleep(80); } };

  await step('history: remove from Continue watching with Undo; History page removes and clears (with confirmation)', async () => {
    const dev = await b.newDevice(); // fresh profile: earlier steps saved and watched things in the default one
    const page = await b.newPage({ width: 1280, height: 900, label: 'history', context: dev });
    try {
      await open(page, '#/');
      await seedHistory(page, ITEMS);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitFor(() => page.$('.rail[data-rail=continue] .card-wrap'), { what: 'continue rail' });
      const titles = () => page.$$eval('.rail[data-rail=continue] .card-wrap .t', (e) => e.map((x) => x.textContent));
      assert.deepEqual(await titles(), ['Paper Cities', 'Breaking Bad', 'The Matrix']);
      assert.ok(await page.$('.rail[data-rail=continue] a.more[href="#/history"]'), 'See all link');
      await page.click('.rail[data-rail=continue] button[aria-label="Remove Breaking Bad from your history"]');
      assert.deepEqual(await titles(), ['Paper Cities', 'The Matrix']);
      await waitFor(() => page.$('.toast button'), { what: 'undo toast' });
      await shot(page, 'history-removed-undo');
      await page.click('.toast button');
      assert.deepEqual(await titles(), ['Paper Cities', 'Breaking Bad', 'The Matrix'], 'Undo puts it back in place');
      assert.equal(await page.evaluate(() => document.activeElement.closest('.card-wrap')?.dataset.key), 'tv:1396', 'focus returns to the restored title');
      // from the keyboard: focus moves to Undo (nothing is lost for keyboard and screen-reader users)
      await page.focus('.rail[data-rail=continue] button[aria-label="Remove The Matrix from your history"]');
      await page.keyboard.press('Enter');
      assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.textContent), 'Undo', 'focus on Undo');
      assert.equal(await page.$$eval('.toast.has-action', (e) => e.length), 1, 'one Undo at a time');
      await page.click('.toast .dismiss');
      assert.equal(await page.$$eval('.toast.has-action', (e) => e.length), 0, 'Dismiss closes it');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitFor(() => page.$('.rail[data-rail=continue] .card-wrap'), { what: 'continue rail after reload' });
      assert.deepEqual(await titles(), ['Breaking Bad', 'Paper Cities'], 'the removal is saved (Undo also moved Breaking Bad to the front)');
      await open(page, '#/history');
      await waitFor(() => page.$('.grid .card-wrap'), { what: 'history grid' });
      assert.equal(await text(page, '.page-head h1'), 'History');
      assert.equal(await page.$eval('[data-nav=history]', (e) => e.getAttribute('aria-current')), 'page');
      await page.click('.grid button[aria-label="Remove Paper Cities from your history"]');
      assert.equal(await page.$$eval('.grid .card-wrap', (e) => e.length), 1);
      await page.click('.grid button[aria-label="Remove Breaking Bad from your history"]');
      await waitFor(() => hasText(page, '.empty h2', /No history yet/), { what: 'empty state after removing the last one' });
      assert.equal(await page.$$eval('.page-head .btn', (e) => e.filter((x) => /Clear history/.test(x.textContent)).length), 0, 'no Clear button on an empty history');
      await clickByText(page, '.toast button', /^Undo$/);
      await waitFor(async () => (await page.$$eval('.grid .card-wrap', (e) => e.length)) === 1, { what: 'undo brings the page back' });
      await clickByText(page, '.page-head .btn', /^Clear history$/);
      await page.waitForSelector('dialog.sheet[open] .btn.danger');
      assert.match(await text(page, 'dialog.sheet .lead'), /^The 1 title will be removed/, 'counts what is there now');
      await clickByText(page, 'dialog.sheet .btn', /^Cancel$/);
      assert.equal(await page.$$eval('.grid .card-wrap', (e) => e.length), 1, 'Cancel keeps everything');
      await clickByText(page, '.page-head .btn', /^Clear history$/);
      await page.waitForSelector('dialog.sheet[open] .btn.danger');
      await clickByText(page, 'dialog.sheet[open] .btn.danger', /^Clear history$/); // look up and click in one step
      await waitFor(() => hasText(page, '.empty h2', /No history yet/), { what: 'empty history' });
      assert.deepEqual(await b.cspViolations(page), []);
    } finally { await page.close(); await dev.close(); }
  });

  await step('lists: save sheet (switch per list, create a list), lists page rename / remove with Undo / delete with confirmation, home rails', async () => {
    const dev = await b.newDevice();
    const page = await b.newPage({ width: 1280, height: 900, label: 'lists', context: dev });
    try {
      await open(page, '#/movie/603');
      await waitFor(() => page.$('.dinfo h1'), { what: 'details' });
      await page.click('button[aria-label="Save to a list"]');
      await page.waitForSelector('dialog.sheet[open] .row input[type=checkbox]');
      assert.equal(await text(page, 'dialog.sheet .sheet-head h2'), 'Save to listThe Matrix');
      await page.type('dialog.sheet input[aria-label="New list name"]', 'Weekend');
      await page.click('dialog.sheet button[type=submit]');
      await waitFor(async () => (await page.$$eval('dialog.sheet .row input[type=checkbox]', (e) => e.length)) === 2, { what: 'new list row' });
      const state = await page.$$eval('dialog.sheet .row', (rows) => rows.filter((r) => r.querySelector('input[type=checkbox]')).map((r) => [r.querySelector('label').textContent, r.querySelector('input').checked]));
      assert.deepEqual(state, [['My List', false], ['Weekend', true]], 'created and saved into it');
      await page.type('dialog.sheet input[aria-label="New list name"]', 'weekend');
      await page.click('dialog.sheet button[type=submit]');
      await waitFor(() => hasText(page, 'dialog.sheet .err-text', /already exists/), { what: 'duplicate name message' });
      await page.click('dialog.sheet .row input[type=checkbox]'); // also My List
      await shot(page, 'save-to-list');
      await page.keyboard.press('Escape');
      await waitFor(() => page.$('.dinfo .iconbtn.on'), { what: 'button shows saved' });
      await open(page, '#/list');
      await waitFor(() => page.$('.listsec .card-wrap'), { what: 'lists page' });
      assert.deepEqual(await page.$$eval('.listsec h2', (e) => e.map((x) => x.textContent)), ['My List1 title', 'Weekend1 title']);
      assert.equal(await page.$$eval('.listsec[data-list=default] button.danger', (e) => e.length), 0, 'My List cannot be deleted');
      await clickByText(page, '.listsec:not([data-list=default]) .btn', /^Rename$/);
      await page.waitForSelector('dialog.sheet[open] #list-name');
      await page.$eval('#list-name', (e) => { e.value = ''; }); await page.type('#list-name', 'Film night');
      await page.click('dialog.sheet button[type=submit]');
      await waitFor(() => hasText(page, '.listsec h2', /^Film night/), { what: 'renamed' });
      await page.click('.listsec[data-list=default] button[aria-label="Remove The Matrix from My List"]');
      assert.match(await text(page, '.listsec[data-list=default] .hint').catch(() => ''), /^$|Empty/);
      await waitFor(() => page.$('.toast button'), { what: 'undo' });
      await page.click('.toast button');
      assert.equal(await page.$$eval('.listsec[data-list=default] .card-wrap', (e) => e.length), 1, 'undo restores');
      await open(page, '#/');
      await waitFor(() => page.$('.rail[data-rail^="list-"]'), { what: 'list rails on home' });
      assert.deepEqual(await page.$$eval('.rail[data-rail^="list-"] h2', (e) => e.map((x) => x.textContent)), ['My List', 'Film night']);
      await open(page, '#/list');
      await waitFor(() => page.$('.listsec'), { what: 'lists' });
      await page.click('button[aria-label="Delete Film night"]');
      await page.waitForSelector('dialog.sheet[open] .btn.danger');
      assert.match(await text(page, 'dialog.sheet .lead'), /1 saved title/);
      await page.click('dialog.sheet .btn.danger');
      await waitFor(async () => (await page.$$eval('.listsec', (e) => e.length)) === 1, { what: 'list deleted' });
      await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
      await shot(page, 'lists-phone');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no horizontal overflow on phones');
      assert.deepEqual(await b.cspViolations(page), []);
    } finally { await page.close(); await dev.close(); }
  });

  let inviteCode = '';
  await step('accounts: admin signs in from the secrets, generates an invite; a new user signs up on another device; wrong codes explain themselves', async () => {
    const page = await b.newPage({ width: 1280, height: 900, label: 'admin' });
    const dev2 = await b.newDevice();
    const p2 = await b.newPage({ width: 390, height: 844, label: 'signup', context: dev2 });
    p2.__ignoreErrors = /status of 400 \(Bad Request\)/; // the deliberate wrong invite code
    try {
      await open(page, '#/');
      await signIn(page, E2E_ADMIN.username, E2E_ADMIN.password);
      await waitFor(() => hasText(page, 'dialog.sheet .set-group .tag', /Admin/), { what: 'admin badge in settings' });
      await shot(page, 'settings-account-admin');
      await clickByText(page, 'dialog.sheet .set-group a.btn', /^Admin$/);
      await waitFor(() => hasText(page, '.page-head h1', /^Admin$/), { what: 'admin page' });
      await waitFor(() => page.$('.admin .row[data-user]'), { what: 'users list' });
      assert.ok(await hasText(page, '.admin .row[data-user=owner] .tag', /You/));
      await page.type('#inv-note', 'for Alice');
      await page.click('.admin form button[type=submit]');
      await page.waitForSelector('dialog.sheet[open] code[data-secret="Invite code"]');
      inviteCode = await text(page, 'dialog.sheet code[data-secret="Invite code"]');
      assert.match(inviteCode, /^[2-9A-Z]{4}-[2-9A-Z]{4}-[2-9A-Z]{4}$/);
      await clickByText(page, 'dialog.sheet .btn', /^Done$/);
      await waitFor(() => page.$('.admin .row[data-invite][data-status=active]'), { what: 'invite listed' });
      assert.ok(await hasText(page, '.admin .row[data-invite]', new RegExp(inviteCode.slice(-4) + '.*for Alice')));
      // device 2: sign up (first with a wrong code)
      await open(p2, '#/');
      await openSettings(p2);
      await waitFor(() => hasText(p2, 'dialog.sheet .set-group button', /^Create account$/), { what: 'create account button' });
      await clickByText(p2, 'dialog.sheet .set-group button', /^Create account$/);
      await p2.waitForSelector(`${topSheet} input[name=invite]`);
      await fill(p2, 'invite', 'AAAA-BBBB-CCCC'); await fill(p2, 'username', 'alice'); await fill(p2, 'new-password', 'river stone lantern'); await fill(p2, 'repeat', 'river stone lantern');
      await submit(p2);
      await waitFor(() => hasText(p2, `${topSheet} .err-text`, /invite code is not valid/), { what: 'bad invite message' });
      await fill(p2, 'repeat', 'something else here');
      await fill(p2, 'invite', inviteCode);
      await submit(p2);
      await waitFor(() => hasText(p2, `${topSheet} .err-text`, /do not match/), { what: 'mismatch message' });
      await shot(p2, 'signup-phone');
      await fill(p2, 'repeat', 'river stone lantern');
      await submit(p2);
      await waitFor(async () => (await toastText(p2)).some((t) => t.startsWith('Welcome, alice')), { what: 'welcome' });
      await waitFor(() => hasText(p2, 'dialog.sheet .set-group strong', /^alice$/), { what: 'settings shows the user' });
      assert.equal(await p2.$$eval('dialog.sheet .set-group a.btn', (e) => e.filter((x) => /Admin/.test(x.textContent)).length), 0, 'no admin link for users');
      await open(page, '#/'); await open(page, '#/admin'); // navigate again: the page loads the lists when opened
      await waitFor(() => page.$('.admin .row[data-invite][data-status=used]'), { what: 'invite now used' });
      assert.deepEqual(await b.cspViolations(page), []); assert.deepEqual(await b.cspViolations(p2), []);
    } finally { await page.close(); await p2.close(); await dev2.close(); }
  });

  await step('sync: two devices share history and lists; a removal on one disappears on the other; sign out clears the device', async () => {
    const devA = await b.newDevice(); const devB = await b.newDevice();
    const a = await b.newPage({ width: 1280, height: 900, label: 'deviceA', context: devA });
    const bb = await b.newPage({ width: 390, height: 844, label: 'deviceB', context: devB });
    bb.__ignoreErrors = /status of 401 \(Unauthorized\)/; // the check that the session is gone after signing out
    try {
      await open(a, '#/'); await signIn(a, 'alice', 'river stone lantern'); await closeSheets(a);
      await seedHistory(a, [ITEMS[0], ITEMS[1]]);
      await a.evaluate(async () => { const { store } = await import('/js/store.js'); store.addToList('default', { type: 'movie', id: 5, title: 'Paper Cities', poster: '/p5.jpg' }); });
      await a.evaluate(async () => (await import('/js/account.js')).account.flush());
      await open(bb, '#/'); await signIn(bb, 'alice', 'river stone lantern'); await closeSheets(bb);
      await open(bb, '#/list');
      await waitFor(() => bb.$('.listsec[data-list=default] .card-wrap'), { what: 'list arrived on device B' });
      assert.match(await text(bb, '.page-head p'), /Synced to alice/);
      await open(bb, '#/history');
      await waitFor(async () => (await bb.$$eval('.grid .card-wrap', (e) => e.length)) === 2, { what: 'history arrived' });
      await bb.click('.grid button[aria-label="Remove The Matrix from your history"]');
      await bb.evaluate(async () => (await import('/js/account.js')).account.flush());
      // device A pulls (as it does on focus, every few minutes, or here explicitly) and its open page updates
      await open(a, '#/history');
      await waitFor(() => a.$('.grid .card-wrap'), { what: 'history on A' });
      await a.evaluate(async () => (await import('/js/account.js')).account.syncNow());
      await waitFor(async () => (await a.$$eval('.grid .card-wrap .t', (e) => e.map((x) => x.textContent))).join() === 'Breaking Bad', { what: 'removal reached A and its page redrew' });
      // sign out on B: confirmation, then the account's data leaves this device
      await openSettings(bb);
      await waitFor(() => hasText(bb, 'dialog.sheet .set-group button', /^Sign out$/), { what: 'sign out button' });
      await clickByText(bb, 'dialog.sheet .set-group button', /^Sign out$/);
      await bb.waitForSelector(`${topSheet} .lead`);
      assert.match(await text(bb, `${topSheet} .lead`), /removed from this device/);
      await clickByText(bb, `${topSheet} .btn`, /^Sign out$/);
      await waitFor(async () => (await toastText(bb)).includes('Signed out'), { what: 'signed out' });
      await closeSheets(bb);
      await open(bb, '#/list');
      await waitFor(() => bb.$('.page-head h1'), { what: 'lists page' });
      assert.equal(await bb.$$eval('.card-wrap', (e) => e.length), 0, 'nothing of the account is left on B');
      assert.match(await text(bb, '.page-head p'), /Saved on this device/);
      assert.equal(await bb.evaluate(() => fetch('/api/sync').then((r) => r.status)), 401, 'and the session is gone');
    } finally { await a.close(); await bb.close(); await devA.close(); await devB.close(); }
  });

  await step('password change signs out the other device; admin resets a password, disables a code, removes a user; non-admins are refused', async () => {
    const devA = await b.newDevice(); const devB = await b.newDevice(); const devAdmin = await b.newDevice();
    const a = await b.newPage({ width: 1280, height: 900, label: 'pwA', context: devA });
    const bb = await b.newPage({ width: 1280, height: 900, label: 'pwB', context: devB });
    const ad = await b.newPage({ width: 1280, height: 900, label: 'admin2', context: devAdmin });
    ad.__expectErrors = true; a.__expectErrors = true; bb.__expectErrors = true; // 401/403 answers are part of this step
    try {
      await open(a, '#/'); await signIn(a, 'alice', 'river stone lantern');
      await open(bb, '#/'); await signIn(bb, 'alice', 'river stone lantern'); await closeSheets(bb);
      await clickByText(a, 'dialog.sheet .set-group button', /^Change password$/);
      await a.waitForSelector(`${topSheet} input[name=current]`);
      await fill(a, 'current', 'wrong password!!'); await fill(a, 'new', 'quiet harbor morning'); await fill(a, 'repeat', 'quiet harbor morning');
      await submit(a);
      await waitFor(() => hasText(a, `${topSheet} .err-text`, /current password is wrong/), { what: 'wrong current' });
      await fill(a, 'current', 'river stone lantern');
      await submit(a);
      await waitFor(async () => (await toastText(a)).some((t) => /Password changed/.test(t)), { what: 'changed' });
      await bb.evaluate(async () => (await import('/js/account.js')).account.syncNow());
      await openSettings(bb);
      await waitFor(() => hasText(bb, 'dialog.sheet .set-group p', /You were signed out/), { what: 'B told it was signed out' });
      await closeSheets(a);
      // a non-admin opening the admin page
      await open(a, '#/admin');
      await waitFor(() => hasText(a, '.empty h2', /Admins only/), { what: 'refused' });
      assert.equal(await a.evaluate(() => fetch('/api/admin/users').then((r) => r.status)), 403, 'the server refuses too');
      // admin: reset alice, disable the code, remove alice
      await open(ad, '#/'); await signIn(ad, E2E_ADMIN.username, E2E_ADMIN.password); await closeSheets(ad);
      await open(ad, '#/admin');
      await waitFor(() => ad.$('.admin .row[data-user=alice]'), { what: 'alice listed' });
      await ad.click('button[aria-label="Reset password for alice"]');
      await ad.waitForSelector(`${topSheet} .btn.primary`);
      await clickByText(ad, `${topSheet} .btn`, /^Reset password$/);
      await ad.waitForSelector('dialog.sheet[open] code[data-secret="Temporary password"]');
      const temp = await text(ad, 'dialog.sheet code[data-secret="Temporary password"]');
      await clickByText(ad, 'dialog.sheet .btn', /^Done$/);
      assert.equal(await a.evaluate(() => fetch('/api/sync').then((r) => r.status)), 401, 'reset signs alice out');
      await a.evaluate(async (pw) => (await import('/js/account.js')).account.signIn('alice', pw), temp);
      assert.equal(await a.evaluate(() => fetch('/api/sync').then((r) => r.status)), 200, 'temporary password works');
      await ad.evaluate(() => { location.hash = '#/'; }); await open(ad, '#/admin');
      await waitFor(() => ad.$('.admin .row[data-invite]'), { what: 'invites' });
      const make = await ad.evaluate(async () => (await import('/js/account.js')).account.admin.createInvite({ maxUses: 5 }));
      await open(ad, '#/'); await open(ad, '#/admin');
      await waitFor(() => ad.$(`button[aria-label="Disable invite ending ${make.code.slice(-4)}"]`), { what: 'disable button' });
      await ad.click(`button[aria-label="Disable invite ending ${make.code.slice(-4)}"]`);
      await ad.waitForSelector(`${topSheet} .btn.danger`); await ad.click(`${topSheet} .btn.danger`);
      await waitFor(() => ad.$('.admin .row[data-invite][data-status=disabled]'), { what: 'disabled' });
      await ad.click('button[aria-label="Remove alice"]');
      await ad.waitForSelector(`${topSheet} .btn.danger`);
      assert.match(await text(ad, `${topSheet} .lead`), /cannot be undone/);
      await ad.click(`${topSheet} .btn.danger`);
      await waitFor(async () => !(await ad.$('.admin .row[data-user=alice]')), { what: 'alice removed' });
      assert.equal(await a.evaluate(() => fetch('/api/sync').then((r) => r.status)), 401, 'removed user is signed out');
      await shot(ad, 'admin-desktop');
      await ad.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
      await shot(ad, 'admin-phone');
      assert.ok(await ad.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'admin page fits a phone');
      assert.deepEqual(await b.cspViolations(ad), []);
    } finally { for (const p of [a, bb, ad]) await p.close(); for (const d of [devA, devB, devAdmin]) await d.close(); }
  });

  await step('accounts off (no database): the site works as before and Settings shows no Account section', async () => {
    const off = await ctx.startApp({ accounts: false, bdix: ctx.bdix });
    const page = await b.newPage({ width: 1280, height: 800, label: 'no-accounts' });
    page.__expectErrors = true; // /api/auth/me answers 503 by design
    try {
      await page.goto(off.origin + '/#/', { waitUntil: 'domcontentloaded' });
      await waitFor(() => page.$('.rail .card'), { what: 'home works' });
      await openSettings(page);
      await sleep(300);
      assert.equal(await page.$$eval('dialog.sheet .set-group h3', (e) => e.filter((x) => x.textContent === 'Account').length), 0);
    } finally { await page.close(); off.close(); }
  });
  void app;
}
