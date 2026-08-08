'use strict';
// Thin Google Calendar + Tasks REST client with per-account token refresh.
const store = require('./store');
const { refreshAccessToken } = require('./oauth');

const CAL = 'https://www.googleapis.com/calendar/v3';
const TASKS = 'https://tasks.googleapis.com/tasks/v1';

async function accessToken(email, force = false) {
  const tok = store.getTokens(email);
  if (!tok || !tok.refresh_token) throw new Error(`Account ${email} is not signed in.`);
  if (!force && tok.access_token && tok.expires_at - 60_000 > Date.now()) {
    return tok.access_token;
  }
  const cfg = store.get();
  const fresh = await refreshAccessToken(cfg.clientId, cfg.clientSecret, tok.refresh_token);
  // a failed save must never break the API call — the token works in memory
  try { store.setTokens(email, fresh); }
  catch (e) { console.warn(`could not persist refreshed token for ${email}:`, e.message); }
  return fresh.access_token;
}

async function api(email, url, { method = 'GET', body, query } = {}) {
  const full = new URL(url);
  if (query) for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null) full.searchParams.set(k, v);
  }
  let token = await accessToken(email);
  const doFetch = () => fetch(full, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let res = await doFetch();
  if (res.status === 401) {
    token = await accessToken(email, true);
    res = await doFetch();
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error?.message || `HTTP ${res.status}`;
    throw new Error(`Google API (${email}): ${msg}`);
  }
  return data;
}

async function listCalendars(email) {
  const items = [];
  let pageToken;
  do {
    const data = await api(email, `${CAL}/users/me/calendarList`, {
      query: { maxResults: 250, pageToken },
    });
    items.push(...(data.items || []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return items;
}

async function listEvents(email, calendarId, timeMin, timeMax) {
  const items = [];
  let pageToken;
  do {
    const data = await api(email, `${CAL}/calendars/${encodeURIComponent(calendarId)}/events`, {
      query: {
        timeMin, timeMax,
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: 2500,
        pageToken,
      },
    });
    items.push(...(data.items || []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return items;
}

const getEvent = (email, calendarId, eventId) =>
  api(email, `${CAL}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`);

const insertEvent = (email, calendarId, resource, opts = {}) =>
  api(email, `${CAL}/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: 'POST', body: resource,
    query: { sendUpdates: opts.sendUpdates, conferenceDataVersion: opts.conferenceDataVersion },
  });

const patchEvent = (email, calendarId, eventId, patch, opts = {}) =>
  api(email, `${CAL}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
    method: 'PATCH', body: patch,
    query: { sendUpdates: opts.sendUpdates, conferenceDataVersion: opts.conferenceDataVersion },
  });

// Free/busy lookup for one or more calendars (e.g. a coworker's email).
const freeBusy = (email, timeMin, timeMax, ids) =>
  api(email, `${CAL}/freeBusy`, {
    method: 'POST',
    body: { timeMin, timeMax, items: ids.map((id) => ({ id })) },
  });

const deleteEvent = (email, calendarId, eventId, opts = {}) =>
  api(email, `${CAL}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
    method: 'DELETE',
    query: { sendUpdates: opts.sendUpdates },
  });

async function listTaskLists(email) {
  const data = await api(email, `${TASKS}/users/@me/lists`, { query: { maxResults: 100 } });
  return data.items || [];
}

async function listTasks(email, tasklistId) {
  const items = [];
  let pageToken;
  do {
    const data = await api(email, `${TASKS}/lists/${encodeURIComponent(tasklistId)}/tasks`, {
      query: { maxResults: 100, showCompleted: 'true', showHidden: 'true', pageToken },
    });
    items.push(...(data.items || []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return items;
}

const insertTask = (email, tasklistId, resource) =>
  api(email, `${TASKS}/lists/${encodeURIComponent(tasklistId)}/tasks`, { method: 'POST', body: resource });

const patchTask = (email, tasklistId, taskId, patch) =>
  api(email, `${TASKS}/lists/${encodeURIComponent(tasklistId)}/tasks/${encodeURIComponent(taskId)}`, { method: 'PATCH', body: patch });

const deleteTask = (email, tasklistId, taskId) =>
  api(email, `${TASKS}/lists/${encodeURIComponent(tasklistId)}/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' });

module.exports = {
  listCalendars, freeBusy,
  listEvents, getEvent, insertEvent, patchEvent, deleteEvent,
  listTaskLists, listTasks, insertTask, patchTask, deleteTask,
};
