// Admin page (#/admin): invite codes (generate, see use, disable) and users (reset password, remove).
// The server checks the admin role on every request; this page only hides what a non-admin could not do anyway.
import { h, mount, copyText, formatDate } from '../util.js';
import { account } from '../account.js';
import { toast, confirmSheet, openSheet } from './components.js';

const when = (ms) => (ms ? formatDate(new Date(ms).toISOString().slice(0, 10)) : 'never');

function shownOnce({ title, label, value, note }) {
  const sheet = openSheet({ title });
  const copyBtn = h('button', { class: 'btn small', type: 'button', onClick: async () => { const ok = await copyText(value); toast(ok ? 'Copied' : 'Could not copy. Select it and copy by hand.', { error: !ok }); } }, 'Copy');
  mount(sheet.body, h('p', { class: 'lead' }, note), h('div', { class: 'secret' }, h('span', null, label + ':'), h('code', { class: 'code', dataset: { secret: label } }, value), copyBtn),
    h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'button', onClick: () => sheet.close() }, 'Done')));
  copyBtn.focus();
}

export function adminView({ root, signal }) {
  const st = account.state();
  if (!st.user || st.user.role !== 'admin') {
    mount(root, h('div', { class: 'empty' }, h('h2', null, 'Admins only'), h('p', null, st.user ? 'Your account cannot open this page.' : 'Sign in with an admin account (Settings).'), h('a', { class: 'btn', href: '#/' }, 'Go home')));
    return;
  }
  const invitesBox = h('div', { 'aria-live': 'polite' }, h('p', { class: 'lead' }, 'Loading…'));
  const usersBox = h('div', { 'aria-live': 'polite' }, h('p', { class: 'lead' }, 'Loading…'));
  // a failed load inside a section: a notice one level below the section title, with Try again
  const fail = (box, e, retry) => { if (!signal.aborted) mount(box, h('div', { class: 'notice', role: 'alert' }, h('h3', null, 'Could not load this'), h('p', null, e.message), h('div', { class: 'actions' }, h('button', { class: 'btn small', type: 'button', onClick: retry }, 'Try again')))); };

  // ---- invites ----
  const note = h('input', { class: 'field', id: 'inv-note', maxlength: 80, placeholder: 'Who is it for? (optional)', autocomplete: 'off' });
  const uses = h('select', { id: 'inv-uses' }, [['1', 'One person'], ['5', 'Up to 5 people'], ['20', 'Up to 20 people'], ['0', 'Unlimited']].map(([v, t]) => h('option', { value: v }, t)));
  const days = h('select', { id: 'inv-days' }, [['7', '7 days'], ['30', '30 days'], ['0', 'Never']].map(([v, t]) => h('option', { value: v }, t)));
  const genForm = h('form', { class: 'form' },
    h('label', { for: 'inv-note' }, 'Note', note),
    h('div', { class: 'row', style: { flexWrap: 'wrap' } }, h('label', { for: 'inv-uses' }, 'Can be used by', uses), h('label', { for: 'inv-days' }, 'Expires after', days)),
    h('div', { class: 'actions', style: { marginTop: 0 } }, h('button', { class: 'btn primary', type: 'submit' }, 'Generate invite code')));
  genForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = genForm.querySelector('button'); btn.disabled = true;
    try {
      const { code } = await account.admin.createInvite({ note: note.value, maxUses: Number(uses.value) || null, expiresDays: Number(days.value) || null });
      note.value = '';
      shownOnce({ title: 'Invite code', label: 'Invite code', value: code, note: 'Send this code to the person you invite. It is shown only now: copy it before closing.' });
      loadInvites();
    } catch (err) { toast(err.message, { error: true }); } finally { btn.disabled = false; }
  });

  const statusText = { active: 'Active', used: 'Used up', expired: 'Expired', disabled: 'Disabled' };
  async function loadInvites() {
    try {
      const { invites } = await account.admin.invites();
      if (signal.aborted) return;
      if (!invites.length) return mount(invitesBox, h('p', { class: 'lead' }, 'No invite codes yet.'));
      mount(invitesBox, invites.map((i) => h('div', { class: 'row', dataset: { invite: i.id, status: i.status } },
        h('div', { class: 'who' }, h('strong', null, `…${i.hint}`), i.note ? ` ${i.note}` : '',
          h('small', null, `${i.max_uses === null ? `${i.uses} used, unlimited` : `${i.uses} of ${i.max_uses} used`}; expires ${i.expires_at ? when(i.expires_at) : 'never'}; made ${when(i.created_at)}`)),
        h('span', { class: `tag${i.status === 'active' ? ' good' : ''}` }, statusText[i.status]),
        i.status === 'active' ? h('div', { class: 'actions' }, h('button', { class: 'btn small danger', type: 'button', 'aria-label': `Disable invite ending ${i.hint}`, onClick: async () => {
          if (!(await confirmSheet({ title: 'Disable this invite code?', text: `Code …${i.hint} will stop working. Accounts already created with it are not affected.`, confirmLabel: 'Disable code' }))) return;
          try { await account.admin.disableInvite(i.id); toast('Invite code disabled'); loadInvites(); } catch (err) { toast(err.message, { error: true }); }
        } }, 'Disable')) : null)));
    } catch (e) { fail(invitesBox, e, loadInvites); }
  }

  // ---- users ----
  async function loadUsers() {
    try {
      const { users } = await account.admin.users();
      if (signal.aborted) return;
      mount(usersBox, users.map((u) => h('div', { class: 'row', dataset: { user: u.username } },
        h('div', { class: 'who' }, h('strong', null, u.username), u.role === 'admin' ? h('span', { class: 'tag good', style: { marginLeft: '8px' } }, 'Admin') : null, u.self ? h('span', { class: 'tag', style: { marginLeft: '8px' } }, 'You') : null,
          h('small', null, `Joined ${when(u.created_at)}; last active ${u.last_seen ? when(u.last_seen) : 'never'}${u.invite_note ? `; invite: ${u.invite_note}` : ''}`)),
        u.self ? null : h('div', { class: 'actions' },
          h('button', { class: 'btn small', type: 'button', 'aria-label': `Reset password for ${u.username}`, onClick: async () => {
            if (!(await confirmSheet({ title: `Reset ${u.username}’s password?`, text: 'They are signed out everywhere and get a new temporary password from you. They can change it in Settings after signing in.', confirmLabel: 'Reset password', danger: false }))) return;
            try { const { password } = await account.admin.resetPassword(u.id); shownOnce({ title: `Temporary password for ${u.username}`, label: 'Temporary password', value: password, note: 'Give this to them privately. It is shown only now.' }); } catch (err) { toast(err.message, { error: true }); }
          } }, 'Reset password'),
          h('button', { class: 'btn small danger', type: 'button', 'aria-label': `Remove ${u.username}`, onClick: async () => {
            if (!(await confirmSheet({ title: `Remove ${u.username}?`, text: 'The account, its history, lists and settings are deleted and they are signed out. This cannot be undone.', confirmLabel: 'Remove user' }))) return;
            try { await account.admin.removeUser(u.id); toast(`Removed ${u.username}`); loadUsers(); } catch (err) { toast(err.message, { error: true }); }
          } }, 'Remove')))));
    } catch (e) { fail(usersBox, e, loadUsers); }
  }

  mount(root,
    h('div', { class: 'page-head' }, h('h1', null, 'Admin'), h('p', null, `Signed in as ${st.user.username}.`)),
    h('div', { class: 'admin' },
      h('section', { class: 'set-group', 'aria-label': 'Invite codes' }, h('h2', null, 'Invite codes'), h('p', { class: 'lead' }, 'People need a code to create an account. Codes are shown once when you make them.'), genForm, h('h3', { style: { marginTop: '18px' } }, 'All codes'), invitesBox),
      h('section', { class: 'set-group', 'aria-label': 'Users' }, h('h2', null, 'Users'), usersBox)));
  loadInvites(); loadUsers();
}
