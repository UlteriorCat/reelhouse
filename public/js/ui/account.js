// Account screens: the Account section in Settings, and the sheets for signing in, creating an account (with an
// invite code), changing the password and deleting the account. All network work goes through account.js.
import { h, mount } from '../util.js';
import { account } from '../account.js';
import { openSheet, toast, confirmSheet } from './components.js';
import { href } from '../router.js';

const PASSWORD_HINT = 'At least 10 characters, and not containing your username.';

function field({ label, name, type = 'text', autocomplete, hint, minlength, maxlength = 128, value = '' }) {
  const id = 'f-' + name + '-' + Math.random().toString(36).slice(2, 6);
  const input = h('input', { class: 'field', id, name, type, autocomplete, required: true, minlength, maxlength, value, autocapitalize: 'none', spellcheck: 'false' });
  return { input, el: h('label', { for: id }, label, hint ? h('small', null, hint) : null, input) };
}

/** A form in a sheet: validates with the browser's own rules, disables the button while working, shows errors. */
function formSheet({ title, subtitle, fields, submitLabel, onSubmit, footer, danger = false }) {
  const sheet = openSheet({ title, subtitle });
  const msg = h('p', { class: 'err-text', role: 'alert' });
  const submit = h('button', { class: danger ? 'btn danger' : 'btn primary', type: 'submit' }, submitLabel);
  const form = h('form', { class: 'form' }, fields.map((f) => f.el), msg, h('div', { class: 'actions' }, submit), footer || null);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    msg.textContent = ''; submit.disabled = true; submit.setAttribute('aria-busy', 'true');
    try { await onSubmit(sheet); } catch (err) { msg.textContent = err.message || 'Something went wrong.'; } finally { submit.disabled = false; submit.removeAttribute('aria-busy'); }
  });
  mount(sheet.body, form);
  setTimeout(() => fields[0] && fields[0].input.focus(), 0);
  return sheet;
}

export function signInSheet(after) {
  const user = field({ label: 'Username', name: 'username', autocomplete: 'username', maxlength: 32 });
  const pass = field({ label: 'Password', name: 'password', type: 'password', autocomplete: 'current-password' });
  const toSignup = h('p', { class: 'lead' }, 'New here? ', h('button', { class: 'btn small ghost', type: 'button', onClick: () => { sheet.close(); signUpSheet(after); } }, 'Create an account with an invite code'));
  const sheet = formSheet({
    title: 'Sign in', subtitle: 'Your history and lists on every device', fields: [user, pass], submitLabel: 'Sign in', footer: toSignup,
    onSubmit: async (s) => { const u = await account.signIn(user.input.value.trim(), pass.input.value); s.close(); toast(`Signed in as ${u.username}`); after && after(); },
  });
}

export function signUpSheet(after) {
  const invite = field({ label: 'Invite code', name: 'invite', autocomplete: 'off', hint: 'From the person who runs this site.', maxlength: 20 });
  const user = field({ label: 'Username', name: 'username', autocomplete: 'username', hint: '3 to 32 letters, digits, dot, dash or underscore.', minlength: 3, maxlength: 32 });
  const pass = field({ label: 'Password', name: 'new-password', type: 'password', autocomplete: 'new-password', hint: PASSWORD_HINT, minlength: 10 });
  const again = field({ label: 'Repeat password', name: 'repeat', type: 'password', autocomplete: 'new-password', minlength: 10 });
  user.input.pattern = '[A-Za-z0-9_.\\-]{3,32}';
  const toSignin = h('p', { class: 'lead' }, 'Already have an account? ', h('button', { class: 'btn small ghost', type: 'button', onClick: () => { sheet.close(); signInSheet(after); } }, 'Sign in'));
  const sheet = formSheet({
    title: 'Create account', subtitle: 'Invite only', fields: [invite, user, pass, again], submitLabel: 'Create account', footer: toSignin,
    onSubmit: async (s) => {
      if (pass.input.value !== again.input.value) throw new Error('The passwords do not match.');
      const u = await account.signUp(user.input.value.trim(), pass.input.value, invite.input.value.trim());
      s.close(); toast(`Welcome, ${u.username}. What was on this device is now in your account.`); after && after();
    },
  });
}

export function changePasswordSheet() {
  const cur = field({ label: 'Current password', name: 'current', type: 'password', autocomplete: 'current-password' });
  const next = field({ label: 'New password', name: 'new', type: 'password', autocomplete: 'new-password', hint: PASSWORD_HINT, minlength: 10 });
  const again = field({ label: 'Repeat new password', name: 'repeat', type: 'password', autocomplete: 'new-password', minlength: 10 });
  formSheet({
    title: 'Change password', subtitle: 'You stay signed in here; other devices are signed out', fields: [cur, next, again], submitLabel: 'Change password',
    onSubmit: async (s) => {
      if (next.input.value !== again.input.value) throw new Error('The new passwords do not match.');
      await account.changePassword(cur.input.value, next.input.value);
      s.close(); toast('Password changed. Other devices were signed out.');
    },
  });
}

function deleteAccountSheet(after) {
  const pass = field({ label: 'Password', name: 'password', type: 'password', autocomplete: 'current-password', hint: 'To confirm it is you.' });
  formSheet({
    title: 'Delete account', subtitle: 'Your history, lists and settings are removed from the server', fields: [pass], submitLabel: 'Delete my account', danger: true,
    onSubmit: async (s) => { await account.deleteAccount(pass.input.value); s.close(); toast('Account deleted'); after && after(); },
  });
}

const syncText = (st) => (st.sync === 'syncing' ? 'Syncing…' : st.sync === 'error' ? `Not synced: ${st.error}` : st.lastSync ? 'Synced' : 'Ready to sync');

/** The Account group for the Settings sheet. `redraw` re-renders Settings after a change. */
export function accountSection(redraw, closeSettings) {
  const st = account.state();
  if (st.enabled !== true) return null; // not known yet, or this site has no accounts configured
  const sec = h('section', { class: 'set-group', 'aria-label': 'Account' }, h('h3', null, 'Account'));
  if (!st.user) {
    sec.append(h('p', { class: 'lead' }, 'Sign in to keep your history, lists and settings on all your devices. Creating an account needs an invite code.'),
      h('div', { class: 'actions', style: { marginTop: '12px' } },
        h('button', { class: 'btn small', type: 'button', onClick: () => signInSheet(redraw) }, 'Sign in'),
        h('button', { class: 'btn small', type: 'button', onClick: () => signUpSheet(redraw) }, 'Create account')));
    if (st.error === 'signed_out') sec.append(h('p', { class: 'status-bad', role: 'status' }, 'You were signed out (your password was changed or the account was removed).'));
    return sec;
  }
  const status = h('span', { class: st.sync === 'error' ? 'status-bad' : 'status-ok', role: 'status' }, syncText(st));
  const off = account.onChange((s) => { if (!sec.isConnected) { off(); return; } status.textContent = syncText(s); status.className = s.sync === 'error' ? 'status-bad' : 'status-ok'; });
  sec.append(
    h('div', { class: 'row' }, h('div', null, h('strong', null, st.user.username), st.user.role === 'admin' ? h('span', { class: 'tag good', style: { marginLeft: '8px' } }, 'Admin') : null, h('small', null, 'History, lists, resume positions and playback settings sync. The gateway address stays on each device.')), status),
    h('div', { class: 'actions', style: { marginTop: '8px' } },
      h('button', { class: 'btn small', type: 'button', onClick: () => account.syncNow() }, 'Sync now'),
      h('button', { class: 'btn small', type: 'button', onClick: changePasswordSheet }, 'Change password'),
      st.user.role === 'admin' ? h('a', { class: 'btn small', href: href('/admin'), onClick: () => closeSettings && closeSettings() }, 'Admin') : null,
      h('button', { class: 'btn small', type: 'button', onClick: async () => {
        if (!(await confirmSheet({ title: 'Sign out?', text: 'Your history, lists and settings stay in your account. They are removed from this device so the next person cannot see them.', confirmLabel: 'Sign out', danger: false }))) return;
        await account.signOut(); toast('Signed out'); redraw();
      } }, 'Sign out'),
      h('button', { class: 'btn small danger', type: 'button', onClick: () => deleteAccountSheet(redraw) }, 'Delete account')));
  return sec;
}
