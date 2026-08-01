import { api } from './api.js';
import * as D from './dates.js';
import { renderMonth } from './monthView.js';
import { renderTimeGrid } from './timeGrid.js';
import { renderAgenda } from './agendaView.js';
import { openEditor, openDetails } from './modals.js';
import { renderSidebar, openSettings } from './settings.js';
import { toast } from './toast.js';
import { MEET_COLORS } from './colors.js';

export const state = {
  view: 'month',           // month | week | day | agenda
  cursor: new Date(),
  weekStart: 1,
  demo: false,
  hasCredentials: false,
  accounts: [],
  calendars: [],
  taskLists: [],
  items: { events: [], tasks: [] },
  savedContacts: [],
  meetWith: [],            // [{ email, color, busy, viaAccount }]
  loading: false,
};

export function viewRange() {
  const c = state.cursor;
  if (state.view === 'month') {
    const first = new Date(c.getFullYear(), c.getMonth(), 1);
    const start = D.startOfWeek(first, state.weekStart);
    return { start, end: D.addDays(start, 42) };
  }
  if (state.view === 'week') {
    const start = D.startOfWeek(c, state.weekStart);
    return { start, end: D.addDays(start, 7) };
  }
  if (state.view === 'day') {
    const start = D.startOfDay(c);
    return { start, end: D.addDays(start, 1) };
  }
  const start = D.startOfDay(new Date());
  return { start, end: D.addDays(start, 30) };
}

let loadSeq = 0;
export async function loadItems(force = false) {
  const { start, end } = viewRange();
  // render immediately with whatever we have — data fills in when it arrives
  renderView();
  const seq = ++loadSeq;
  state.loading = true;
  try {
    const [items] = await Promise.all([
      api.getItems({ start: start.toISOString(), end: end.toISOString(), force }),
      refreshMeetWith(start, end),
    ]);
    if (seq !== loadSeq) return; // a newer navigation superseded this load
    state.items = items;
  } catch (e) {
    if (seq === loadSeq) toast(e.message, 'error');
  } finally {
    if (seq === loadSeq) state.loading = false;
  }
  if (seq === loadSeq) renderView();
}

async function refreshMeetWith(start, end) {
  await Promise.all(state.meetWith.map(async (p) => {
    try {
      const res = await api.freeBusy({
        person: p.email,
        start: start.toISOString(),
        end: end.toISOString(),
      });
      p.busy = res.busy;
      p.events = res.events || [];
      p.detailed = !!res.detailed;
      p.viaAccount = res.viaAccount;
    } catch (e) {
      p.busy = [];
      p.events = [];
      p.error = e.message;
    }
  }));
}

// Toggle a "Meet with" overlay for a person's free/busy schedule.
export async function toggleMeetWith(email) {
  const existing = state.meetWith.findIndex((p) => p.email === email);
  if (existing >= 0) {
    state.meetWith.splice(existing, 1);
    renderSidebar();
    renderView();
    return;
  }
  if (state.meetWith.length >= MEET_COLORS.length) {
    toast(`You can overlay up to ${MEET_COLORS.length} people at once.`, 'error');
    return;
  }
  const used = new Set(state.meetWith.map((p) => p.color));
  const color = MEET_COLORS.find((c) => !used.has(c)) || MEET_COLORS[0];
  const name = state.savedContacts.find((c) => c.email === email)?.name || '';
  const person = { email, name, color, busy: [], events: [], viaAccount: null };
  state.meetWith.push(person);
  const { start, end } = viewRange();
  try {
    const res = await api.freeBusy({
      person: email,
      start: start.toISOString(),
      end: end.toISOString(),
    });
    person.busy = res.busy;
    person.events = res.events || [];
    person.detailed = !!res.detailed;
    person.viaAccount = res.viaAccount;
    toast(res.detailed
      ? `Showing ${name || email}'s events (via ${res.viaAccount})`
      : `${name || email} only shares free/busy — showing busy blocks (via ${res.viaAccount})`);
  } catch (e) {
    state.meetWith = state.meetWith.filter((p) => p !== person);
    toast(e.message, 'error');
  }
  renderSidebar();
  await loadItems();
}

export function render() {
  renderTitle();
  renderSidebar();
  renderView();
}

// Toolbar pills: quick view + one-click close for active "Meet with" overlays.
function renderMeetPills() {
  const root = document.getElementById('meet-pills');
  root.innerHTML = '';
  for (const p of state.meetWith) {
    const pill = document.createElement('span');
    pill.className = 'meet-pill';
    pill.style.setProperty('--c', p.color);
    const label = document.createElement('span');
    label.textContent = p.name || p.email.split('@')[0];
    label.title = p.email;
    const x = document.createElement('button');
    x.textContent = '×';
    x.title = `Stop showing ${p.email}'s schedule`;
    x.onclick = () => toggleMeetWith(p.email);
    pill.append(label, x);
    root.appendChild(pill);
  }
}

function renderTitle() {
  const el = document.getElementById('view-title');
  const c = state.cursor;
  if (state.view === 'month') el.textContent = D.fmtMonthYear(c);
  else if (state.view === 'week') {
    const s = D.startOfWeek(c, state.weekStart), e = D.addDays(s, 6);
    el.textContent = s.getMonth() === e.getMonth()
      ? `${s.toLocaleDateString([], { month: 'long' })} ${s.getDate()}–${e.getDate()}, ${e.getFullYear()}`
      : `${D.fmtDayShort(s)} – ${D.fmtDayShort(e)}`;
  } else if (state.view === 'day') el.textContent = D.fmtDayLong(c);
  else el.textContent = 'Next 30 days';

  document.querySelectorAll('#view-switcher button').forEach((b) =>
    b.classList.toggle('active', b.dataset.view === state.view));
}

export function renderView() {
  renderTitle();
  renderMeetPills();
  const root = document.getElementById('view');
  root.innerHTML = '';
  const ctx = {
    state,
    onItemClick: (item, anchorEl) => openDetails(item, anchorEl),
    onDayClick: (date) => { state.cursor = date; setView('day'); },
    onSlotClick: (date) => openEditor({ start: date }),
    onDayCreate: (date) => openEditor({ start: date, allDay: state.view === 'month' }),
  };
  if (state.view === 'month') renderMonth(root, ctx);
  else if (state.view === 'week') renderTimeGrid(root, ctx, 7);
  else if (state.view === 'day') renderTimeGrid(root, ctx, 1);
  else renderAgenda(root, ctx);
}

export function setView(view) {
  state.view = view;
  renderTitle();
  loadItems();
}

function navigate(dir) {
  const c = state.cursor;
  if (state.view === 'month') state.cursor = D.addMonths(c, dir);
  else if (state.view === 'week') state.cursor = D.addDays(c, 7 * dir);
  else if (state.view === 'day') state.cursor = D.addDays(c, dir);
  else return;
  loadItems();
  renderTitle();
}

async function refreshState() {
  const s = await api.getState();
  Object.assign(state, {
    demo: s.demo,
    hasCredentials: s.hasCredentials,
    accounts: s.accounts,
    calendars: s.calendars,
    weekStart: s.weekStart ?? 1,
    widgetEnabled: s.widgetEnabled,
    launchAtStartup: s.launchAtStartup,
    clientId: s.clientId,
    savedContacts: s.savedContacts || [],
  });
  try { state.taskLists = await api.getTaskLists(); } catch { state.taskLists = []; }
}

export async function fullReload(force = false) {
  await refreshState();
  render();
  await loadItems(force);
}

function wireToolbar() {
  document.getElementById('btn-today').onclick = () => { state.cursor = new Date(); loadItems(); renderTitle(); };
  document.getElementById('btn-prev').onclick = () => navigate(-1);
  document.getElementById('btn-next').onclick = () => navigate(1);
  document.getElementById('btn-new').onclick = () => openEditor({});
  document.getElementById('btn-settings').onclick = () => openSettings();
  document.getElementById('btn-refresh').onclick = async () => {
    toast('Refreshing…');
    try { await api.refreshNow(); } catch (e) { toast(e.message, 'error'); }
  };
  document.querySelectorAll('#view-switcher button').forEach((b) => {
    b.onclick = () => setView(b.dataset.view);
  });
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select, dialog')) return;
    if (e.key === 't') { state.cursor = new Date(); loadItems(); }
    else if (e.key === 'n') openEditor({});
    else if (e.key === 'ArrowLeft') navigate(-1);
    else if (e.key === 'ArrowRight') navigate(1);
    else if (e.key === '1') setView('month');
    else if (e.key === '2') setView('week');
    else if (e.key === '3') setView('day');
    else if (e.key === '4') setView('agenda');
  });
}

async function boot() {
  wireToolbar();
  api.onDataChanged(async () => {
    await refreshState();
    renderSidebar();
    loadItems();
  });
  await refreshState();
  render();
  if (!state.demo && (!state.hasCredentials || !state.accounts.length)) {
    openSettings({ onboarding: true });
  }
  await loadItems();
  // keep "today" highlight fresh across midnight
  setInterval(() => renderView(), 15 * 60 * 1000);
}

boot();
