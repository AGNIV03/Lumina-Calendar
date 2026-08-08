'use strict';
// Aggregates events + tasks across accounts with a small TTL cache,
// periodic background refresh, and a change broadcast to all windows.
const store = require('./store');
const google = require('./google');
const demo = require('./demo');

const TTL = 5 * 60 * 1000;
const REFRESH_INTERVAL = 5 * 60 * 1000;

const cache = new Map(); // key -> { ts, items }
let calendarsCache = { ts: 0, byAccount: new Map() };
let taskListsCache = { ts: 0, lists: [] };
let broadcastFn = () => {};
let timer = null;

const isDemo = () => process.argv.includes('--demo');

function setBroadcast(fn) { broadcastFn = fn; }
function broadcast() { try { broadcastFn(); } catch {} }

function invalidate() {
  cache.clear();
  taskListsCache.ts = 0;
}

function invalidateCalendars() {
  calendarsCache = { ts: 0, byAccount: new Map() };
  invalidate();
}

let calendarsFailed = false;

async function getCalendars(force = false) {
  if (isDemo()) return demo.calendars();
  const cfg = store.get();
  if (!force && Date.now() - calendarsCache.ts < TTL && calendarsCache.byAccount.size) {
    return flattenCalendars();
  }
  const byAccount = new Map();
  const results = await Promise.allSettled(cfg.accounts.map(async (acct) => {
    const cals = await google.listCalendars(acct.email);
    byAccount.set(acct.email, cals);
  }));
  calendarsFailed = results.some((r) => r.status === 'rejected');
  if (byAccount.size) {
    calendarsCache = { ts: Date.now(), byAccount };
    const flat = flattenCalendars();
    // persist for offline starts (only write when it actually changed);
    // never let a failed save break the fetch path
    try {
      if (JSON.stringify(flat) !== JSON.stringify(store.get().cachedCalendars)) {
        store.set({ cachedCalendars: flat });
      }
    } catch (e) { console.warn('could not persist calendar cache:', e.message); }
    return flat;
  }
  // total failure (offline / Google unreachable): last known list, live visibility
  return (store.get().cachedCalendars || []).map((c) => ({
    ...c,
    visible: store.isCalendarVisible(c.accountEmail, { id: c.id }),
    priority: store.getCalendarPriority(c.accountEmail, c.id) || 1,
  }));
}

function flattenCalendars() {
  const out = [];
  for (const [email, cals] of calendarsCache.byAccount) {
    for (const c of cals) {
      out.push({
        accountEmail: email,
        id: c.id,
        summary: c.summaryOverride || c.summary,
        color: c.backgroundColor || '#5b7cfa',
        primary: !!c.primary,
        accessRole: c.accessRole,
        visible: store.isCalendarVisible(email, c),
        priority: store.getCalendarPriority(email, c.id) || 1,
      });
    }
  }
  out.sort((a, b) =>
    a.accountEmail.localeCompare(b.accountEmail) ||
    (b.primary - a.primary) ||
    a.summary.localeCompare(b.summary));
  return out;
}

function normalizeEvent(email, cal, ev) {
  const attendees = (ev.attendees || [])
    .filter((a) => !a.resource)
    .map((a) => ({
      email: a.email,
      displayName: a.displayName || '',
      responseStatus: a.responseStatus || 'needsAction',
      self: !!a.self,
      organizer: !!a.organizer,
      optional: !!a.optional,
    }));
  const video = ev.hangoutLink
    || ev.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video')?.uri
    || '';
  const prio = Number(ev.extendedProperties?.private?.luminaPriority);
  const localPrio = store.getLocalPriority(email, cal.id, ev);
  const calDefault = store.getCalendarPriority(email, cal.id);
  return {
    // event's own priority (local override, then Google) → calendar default → 1
    priority: localPrio ?? (prio >= 1 && prio <= 4 ? prio : (calDefault ?? 1)),
    recurringEventId: ev.recurringEventId || null,
    eventType: ev.eventType || 'default',
    kind: 'event',
    accountEmail: email,
    calendarId: cal.id,
    calendarSummary: cal.summary,
    color: cal.color,
    canEdit: ['owner', 'writer'].includes(cal.accessRole),
    id: ev.id,
    summary: ev.summary || '(No title)',
    description: ev.description || '',
    location: ev.location || '',
    allDay: !!ev.start?.date,
    start: ev.start?.dateTime || ev.start?.date,
    end: ev.end?.dateTime || ev.end?.date,
    htmlLink: ev.htmlLink || '',
    hangoutLink: video,
    organizer: ev.organizer ? { email: ev.organizer.email, name: ev.organizer.displayName || '' } : null,
    attendees,
  };
}

// "Meet with": try each connected account for the person's schedule.
// Preferred: full event details (person's calendar shared with the account).
// Fallback: opaque free/busy blocks.
async function meetWithSchedule({ person, start, end }) {
  if (isDemo()) return demo.meetWith(person, start, end);
  const cfg = store.get();
  let lastErr = null;
  const pseudoCal = {
    id: person,
    summary: `${person}'s calendar`,
    color: '#9aa0b4',
    accessRole: 'freeBusyReader', // canEdit: false
  };
  for (const acct of cfg.accounts) {
    try {
      const raw = await google.listEvents(acct.email, person, start, end);
      const events = raw
        .filter((e) => e.status !== 'cancelled')
        .map((e) => ({
          ...normalizeEvent(acct.email, pseudoCal, e),
          summary: e.summary || 'Busy', // private events come without a title
          overlay: true,
        }));
      return { events, busy: [], viaAccount: acct.email, detailed: true };
    } catch (e) { lastErr = e; }
  }
  for (const acct of cfg.accounts) {
    try {
      const res = await google.freeBusy(acct.email, start, end, [person]);
      const cal = res.calendars?.[person];
      if (cal && !cal.errors) {
        return { events: [], busy: cal.busy || [], viaAccount: acct.email, detailed: false };
      }
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error(`None of your accounts can see ${person}'s calendar.`);
}

// Whole-month buckets that cover [start, end] — adjacent navigation reuses them.
function monthBuckets(startISO, endISO) {
  const start = new Date(startISO);
  const end = new Date(endISO);
  const buckets = [];
  let cur = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cur < end) {
    const next = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
    buckets.push({
      key: `${cur.getFullYear()}-${cur.getMonth()}`,
      start: cur.toISOString(),
      end: next.toISOString(),
    });
    cur = next;
  }
  return buckets;
}

async function fetchCalendarMonth(email, cal, bucket, force) {
  const key = `ev|${email}|${cal.id}|${bucket.key}`;
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.ts < TTL) return hit.items;
  const raw = await google.listEvents(email, cal.id, bucket.start, bucket.end);
  const items = raw
    .filter((e) => e.status !== 'cancelled')
    .map((e) => normalizeEvent(email, cal, e));
  cache.set(key, { ts: Date.now(), items });
  return items;
}

async function fetchCalendarRange(email, cal, startISO, endISO, force) {
  const parts = await Promise.all(
    monthBuckets(startISO, endISO).map((b) => fetchCalendarMonth(email, cal, b, force))
  );
  // events spanning a month boundary appear in both buckets — dedupe
  const seen = new Map();
  for (const ev of parts.flat()) seen.set(ev.id, ev);
  return [...seen.values()];
}

async function getTaskLists(force = false) {
  if (isDemo()) return demo.taskLists();
  const cfg = store.get();
  if (!force && Date.now() - taskListsCache.ts < TTL && taskListsCache.lists.length) {
    return taskListsCache.lists;
  }
  const lists = [];
  await Promise.allSettled(cfg.accounts.map(async (acct) => {
    const ls = await google.listTaskLists(acct.email);
    for (const l of ls) lists.push({ accountEmail: acct.email, id: l.id, title: l.title });
  }));
  if (lists.length) taskListsCache = { ts: Date.now(), lists };
  return lists;
}

async function fetchTasks(force) {
  const lists = await getTaskLists(force);
  const key = 'tasks|all';
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.ts < TTL) return hit.items;
  const items = [];
  await Promise.allSettled(lists.map(async (l) => {
    const raw = await google.listTasks(l.accountEmail, l.id);
    for (const t of raw) {
      if (t.deleted) continue;
      items.push({
        kind: 'task',
        accountEmail: l.accountEmail,
        tasklistId: l.id,
        tasklistTitle: l.title,
        id: t.id,
        title: t.title || '(No title)',
        notes: t.notes || '',
        due: t.due ? t.due.slice(0, 10) : null, // date-only semantics
        completed: t.status === 'completed',
      });
    }
  }));
  cache.set(key, { ts: Date.now(), items });
  return items;
}

// Main entry: everything the renderer needs for a date range.
// `errors` is non-empty when Google could not be reached for some data,
// so the UI can say "retrying" instead of silently looking wiped.
async function getItems({ start, end, force = false } = {}) {
  if (isDemo()) return demo.items(start, end);
  const cfg = store.get();
  if (store.isDegraded()) {
    return {
      events: [], tasks: [],
      errors: ['Waiting for Windows to unlock your settings (encrypted profile).'],
    };
  }
  if (!cfg.accounts.length) return { events: [], tasks: [], errors: [] };

  const errors = [];
  const calendars = await getCalendars(force);
  if (calendarsFailed || (cfg.accounts.length && !calendars.length)) {
    errors.push("Can't reach Google Calendar.");
  }
  const visible = calendars.filter((c) => c.visible);
  const results = await Promise.allSettled(
    visible.map((c) => fetchCalendarRange(c.accountEmail, c, start, end, force))
  );
  const events = [];
  let failed = 0;
  for (const r of results) {
    if (r.status === 'fulfilled') events.push(...r.value);
    else failed++;
  }
  if (failed && !errors.length) {
    errors.push(`${failed} calendar${failed > 1 ? 's' : ''} failed to load.`);
  }
  const tasks = await fetchTasks(force).catch(() => []);
  return { events, tasks, errors };
}

function startTimer() {
  if (timer) return;
  timer = setInterval(async () => {
    if (isDemo() || !store.get().accounts.length) return;
    invalidate();
    broadcast(); // windows re-request their ranges, which repopulates the cache
  }, REFRESH_INTERVAL);
}

async function refreshNow() {
  invalidateCalendars();
  broadcast();
}

module.exports = {
  setBroadcast, broadcast, startTimer, refreshNow,
  getCalendars, getTaskLists, getItems, meetWithSchedule,
  invalidate, invalidateCalendars,
};
