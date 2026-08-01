import { api } from './api.js';
import { state, fullReload, loadItems, toggleMeetWith } from './app.js';
import { toast } from './toast.js';
import { suggestionEmails } from './suggest.js';
import { promptDialog, confirmDialog, choiceDialog } from './dialogs.js';
import { PRIORITIES } from './priority.js';

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s ?? '';
  return d.innerHTML;
}

// ---------- Sidebar: accounts + calendar checkboxes ----------
export function renderSidebar() {
  const root = document.getElementById('calendar-list');
  root.innerHTML = '';

  if (!state.accounts.length) {
    const hint = document.createElement('div');
    hint.className = 'sidebar-hint';
    hint.innerHTML = state.hasCredentials
      ? 'No Google account connected yet.'
      : 'Set up Google access to get started.';
    const btn = document.createElement('button');
    btn.className = 'btn-primary small';
    btn.textContent = state.hasCredentials ? 'Add Google account' : 'Open setup';
    btn.onclick = () => state.hasCredentials ? addAccount(btn) : openSettings({ onboarding: true });
    root.append(hint, btn);
    return;
  }

  const groups = new Map();
  for (const c of state.calendars) {
    if (!groups.has(c.accountEmail)) groups.set(c.accountEmail, []);
    groups.get(c.accountEmail).push(c);
  }
  for (const acct of state.accounts) {
    const sec = document.createElement('div');
    sec.className = 'cal-group';
    const head = document.createElement('div');
    head.className = 'cal-group-head';
    head.textContent = acct.email;
    head.title = acct.email;
    sec.appendChild(head);
    for (const cal of groups.get(acct.email) || []) {
      sec.appendChild(calRow(cal));
    }
    root.appendChild(sec);
  }

  root.appendChild(meetWithSection());
}

// ---------- "Meet with" — free/busy overlays + pinned contacts ----------
function meetWithSection() {
  const sec = document.createElement('div');
  sec.className = 'cal-group meet-section';
  const head = document.createElement('div');
  head.className = 'cal-group-head';
  head.textContent = 'Meet with…';
  sec.appendChild(head);

  const form = document.createElement('form');
  form.className = 'meet-form';
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'person@company.com';
  input.setAttribute('list', 'meet-suggest');
  input.autocomplete = 'off';
  const dl = document.createElement('datalist');
  dl.id = 'meet-suggest';
  for (const email of suggestionEmails()) {
    const o = document.createElement('option');
    o.value = email;
    dl.appendChild(o);
  }
  form.append(input, dl);
  form.onsubmit = (e) => {
    e.preventDefault();
    const email = input.value.trim().toLowerCase();
    if (!email) return;
    input.value = '';
    toggleMeetWith(email);
  };
  sec.appendChild(form);

  const shown = new Set();
  const addRow = (email, name) => {
    if (shown.has(email)) return;
    shown.add(email);
    sec.appendChild(meetRow(email, name));
  };
  for (const c of state.savedContacts) addRow(c.email, c.name);
  for (const p of state.meetWith) addRow(p.email, p.name);
  return sec;
}

function meetRow(email, name) {
  const active = state.meetWith.find((p) => p.email === email);
  const pinned = state.savedContacts.some((c) => c.email === email);

  const row = document.createElement('div');
  row.className = 'meet-row' + (active ? ' active' : '');

  const toggle = document.createElement('button');
  toggle.className = 'meet-toggle';
  toggle.title = active ? 'Hide schedule' : 'Show schedule on the calendar';
  const dot = document.createElement('span');
  dot.className = 'meet-dot';
  if (active) dot.style.background = active.color;
  const label = document.createElement('span');
  label.className = 'meet-label';
  label.textContent = name || email;
  label.title = email;
  toggle.append(dot, label);
  toggle.onclick = () => toggleMeetWith(email);

  const pin = document.createElement('button');
  pin.className = 'meet-pin';
  pin.textContent = pinned ? '✕' : '☆';
  pin.title = pinned ? 'Remove from sidebar' : 'Save to sidebar';
  pin.onclick = async () => {
    try {
      if (pinned) {
        if (!await confirmDialog({
          title: `Remove ${name || email}?`,
          message: 'It will disappear from the sidebar. You can always add it back.',
          confirmLabel: 'Remove',
        })) return;
        state.savedContacts = await api.removeContact(email);
      } else {
        const displayName = await promptDialog({
          title: 'Save to sidebar',
          message: `Give ${email} a name — it's shown in the sidebar and on the calendar.`,
          placeholder: 'e.g. Maya (Design)',
        });
        if (displayName === null) return; // cancelled
        state.savedContacts = await api.addContact({ email, name: displayName });
        const active = state.meetWith.find((p) => p.email === email);
        if (active) active.name = displayName;
      }
      renderSidebar();
      loadItems();
    } catch (e) { toast(e.message, 'error'); }
  };

  const rename = document.createElement('button');
  rename.className = 'meet-pin';
  rename.textContent = '✎';
  rename.title = 'Rename';
  rename.hidden = !pinned;
  rename.onclick = async () => {
    const displayName = await promptDialog({
      title: `Rename ${email}`,
      placeholder: 'Display name',
      value: name || '',
    });
    if (displayName === null) return;
    try {
      state.savedContacts = await api.addContact({ email, name: displayName });
      const active = state.meetWith.find((p) => p.email === email);
      if (active) active.name = displayName;
      renderSidebar();
      loadItems();
    } catch (e) { toast(e.message, 'error'); }
  };

  row.append(toggle, rename, pin);
  return row;
}

function calRow(cal) {
  const label = document.createElement('label');
  label.className = 'cal-row';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = cal.visible;
  cb.style.setProperty('--c', cal.color);
  cb.onchange = async () => {
    try {
      await api.setCalendarVisibility({
        accountEmail: cal.accountEmail,
        calendarId: cal.id,
        visible: cb.checked,
      });
      cal.visible = cb.checked;
    } catch (e) {
      toast(e.message, 'error');
      cb.checked = !cb.checked;
    }
  };
  const name = document.createElement('span');
  name.textContent = cal.summary;
  name.title = cal.summary;

  // per-calendar default priority
  const prio = cal.priority || 1;
  const flag = document.createElement('button');
  flag.type = 'button';
  flag.className = 'cal-prio' + (prio > 1 ? ' set' : '');
  flag.textContent = '⚑';
  if (prio > 1) flag.style.color = PRIORITIES[prio].color;
  flag.title = prio > 1
    ? `Calendar default: ${PRIORITIES[prio].label} — click to change`
    : 'Set a default priority for every event in this calendar';
  flag.onclick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const v = await choiceDialog({
      title: `Default priority — ${cal.summary}`,
      message: 'Every event in this calendar gets this priority unless the event has its own.',
      buttons: [1, 2, 3, 4].map((p) => ({
        label: `⚑ ${PRIORITIES[p].label}${p === 1 ? ' (no default)' : ''}`,
        value: String(p),
        kind: p === prio ? 'primary' : 'ghost',
      })),
    });
    if (!v) return;
    try {
      await api.setCalendarPriority({
        accountEmail: cal.accountEmail,
        calendarId: cal.id,
        priority: +v,
      });
      cal.priority = +v;
      renderSidebar();
      loadItems(true);
    } catch (err) { toast(err.message, 'error'); }
  };

  label.append(cb, name, flag);
  return label;
}

async function addAccount(btn) {
  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Waiting for browser…';
  try {
    const res = await api.addAccount();
    toast(`Signed in as ${res.email}`);
    await fullReload(true);
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = orig;
  }
}

// ---------- Settings dialog ----------
export function openSettings({ onboarding = false } = {}) {
  const root = document.getElementById('modal-root');
  root.innerHTML = '';
  const dlg = document.createElement('dialog');
  dlg.className = 'settings';
  root.appendChild(dlg);
  dlg.addEventListener('close', () => setTimeout(() => dlg.remove(), 150));
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });

  const accountsHtml = state.accounts.map((a) => `
    <div class="acct-row" data-email="${esc(a.email)}">
      <div class="acct-info"><strong>${esc(a.name)}</strong><span>${esc(a.email)}</span></div>
      <button class="btn-ghost danger small" data-act="remove">Remove</button>
    </div>`).join('') || '<p class="muted">No accounts connected.</p>';

  dlg.innerHTML = `
    <div class="settings-card">
      <h2>${onboarding ? 'Welcome to Lumina 👋' : 'Settings'}</h2>
      ${onboarding ? '<p class="muted">Two quick steps: paste your Google OAuth credentials, then sign in.</p>' : ''}

      <section>
        <h3>Google API credentials</h3>
        <p class="muted small-text">One-time setup. <button class="linklike" data-act="guide">Show me how to create these</button></p>
        <label class="row"><span>Client ID</span>
          <input name="clientId" autocomplete="off" spellcheck="false" placeholder="xxxx.apps.googleusercontent.com" value="${esc(state.clientId || '')}"/></label>
        <label class="row"><span>Client secret</span>
          <input name="clientSecret" type="password" autocomplete="off" placeholder="${state.hasCredentials ? '••••••••  (saved)' : 'GOCSPX-…'}"/></label>
        <button class="btn-ghost" data-act="save-creds">Save credentials</button>
      </section>

      <section>
        <h3>Accounts</h3>
        <div class="acct-list">${accountsHtml}</div>
        <button class="btn-primary small" data-act="add-account" ${state.hasCredentials ? '' : 'disabled'}>Add Google account</button>
      </section>

      <section>
        <h3>App</h3>
        <label class="row check"><input type="checkbox" name="widget" ${state.widgetEnabled ? 'checked' : ''}/><span>Show desktop widget</span></label>
        <label class="row check"><input type="checkbox" name="startup" ${state.launchAtStartup ? 'checked' : ''}/><span>Launch at startup (hidden in tray)</span></label>
        <p class="muted small-text">Closing the window keeps Lumina running in the tray so the widget stays fresh.</p>
      </section>

      <div class="editor-actions"><button class="btn-primary" data-act="close">Done</button></div>
    </div>`;

  const f = () => ({
    clientId: dlg.querySelector('[name=clientId]').value.trim(),
    clientSecret: dlg.querySelector('[name=clientSecret]').value.trim(),
  });

  dlg.querySelector('[data-act=save-creds]').onclick = async (e) => {
    const { clientId, clientSecret } = f();
    if (!clientId || (!clientSecret && !state.hasCredentials)) {
      toast('Enter both the Client ID and the Client secret.', 'error');
      return;
    }
    try {
      await api.setCredentials({ clientId, clientSecret });
      state.hasCredentials = true;
      state.clientId = clientId;
      toast('Credentials saved');
      dlg.querySelector('[data-act=add-account]').disabled = false;
    } catch (err) { toast(err.message, 'error'); }
  };

  dlg.querySelector('[data-act=add-account]').onclick = (e) => addAccount(e.currentTarget);

  dlg.querySelectorAll('[data-act=remove]').forEach((btn) => {
    btn.onclick = async () => {
      const email = btn.closest('.acct-row').dataset.email;
      if (!await confirmDialog({
        title: `Remove ${email}?`,
        message: 'Its calendars and events will disappear from the app. Your Google data is untouched.',
        confirmLabel: 'Remove account',
      })) return;
      try {
        await api.removeAccount(email);
        toast(`Removed ${email}`);
        dlg.close();
        await fullReload(true);
      } catch (err) { toast(err.message, 'error'); }
    };
  });

  dlg.querySelector('[name=widget]').onchange = async (e) => {
    try { await api.setWidgetEnabled(e.target.checked); state.widgetEnabled = e.target.checked; }
    catch (err) { toast(err.message, 'error'); }
  };
  dlg.querySelector('[name=startup]').onchange = async (e) => {
    try { await api.setLaunchAtStartup(e.target.checked); state.launchAtStartup = e.target.checked; }
    catch (err) { toast(err.message, 'error'); }
  };
  dlg.querySelector('[data-act=guide]').onclick = () => showGuide(dlg);
  dlg.querySelector('[data-act=close]').onclick = () => dlg.close();

  dlg.showModal();
}

function showGuide(parentDlg) {
  const root = document.getElementById('modal-root');
  const dlg = document.createElement('dialog');
  dlg.className = 'settings guide';
  root.appendChild(dlg);
  dlg.addEventListener('close', () => setTimeout(() => dlg.remove(), 150));
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.innerHTML = `
    <div class="settings-card">
      <h2>Create your Google credentials</h2>
      <ol class="guide-steps">
        <li>Open <button class="linklike" data-url="https://console.cloud.google.com/projectcreate">console.cloud.google.com/projectcreate</button> and create a project (any name, e.g. <em>Lumina Calendar</em>).</li>
        <li>Enable both APIs for the project:<br>
          <button class="linklike" data-url="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com">Google Calendar API</button> and
          <button class="linklike" data-url="https://console.cloud.google.com/apis/library/tasks.googleapis.com">Google Tasks API</button> → click <em>Enable</em> on each.</li>
        <li>Go to <button class="linklike" data-url="https://console.cloud.google.com/auth/branding">Google Auth Platform → Branding</button>. If prompted, configure the consent screen: pick <em>External</em>, fill in the app name and your email.</li>
        <li>Under <em>Audience</em>, add every Google account you want to use as a <em>Test user</em> — or click <em>Publish app</em> so sign-ins don't expire weekly (recommended for personal use; the "unverified app" warning is normal, click <em>Advanced → Continue</em>).</li>
        <li>Go to <button class="linklike" data-url="https://console.cloud.google.com/apis/credentials">APIs &amp; Services → Credentials</button> → <em>Create credentials → OAuth client ID</em> → Application type: <strong>Desktop app</strong>.</li>
        <li>Copy the <strong>Client ID</strong> and <strong>Client secret</strong> into Lumina's settings, save, then click <em>Add Google account</em>.</li>
      </ol>
      <p class="muted small-text">Your credentials and tokens stay on this PC (tokens are encrypted with Windows DPAPI). Lumina talks only to Google's APIs.</p>
      <div class="editor-actions"><button class="btn-primary" data-act="close">Got it</button></div>
    </div>`;
  dlg.querySelectorAll('[data-url]').forEach((b) => {
    b.onclick = () => api.openExternal(b.dataset.url);
  });
  dlg.querySelector('[data-act=close]').onclick = () => dlg.close();
  dlg.showModal();
}
