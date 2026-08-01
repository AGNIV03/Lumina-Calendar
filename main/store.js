'use strict';
// Config + encrypted token storage in the Electron userData directory.
const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  clientId: '',
  clientSecret: '',
  accounts: [],        // [{ email, name, picture }]
  visibility: {},      // { "email::calendarId": bool } overrides
  widgetEnabled: true,
  widgetBounds: null,  // { x, y }
  savedContacts: [],   // [{ email, name }] pinned "Meet with" people
  localPriorities: {}, // { "email::calId::eventId": 1-4 } for events Google won't let us tag (birthdays etc.)
  calendarPriorities: {}, // { "email::calId": 2-4 } default priority for every event in a calendar
  launchAtStartup: false,
  weekStart: 1,        // 1 = Monday, 0 = Sunday
};

let dir = null;
let configPath = null;
let tokensPath = null;
let config = null;

function init() {
  dir = app.getPath('userData');
  configPath = path.join(dir, 'config.json');
  tokensPath = path.join(dir, 'tokens.dat');
  try {
    config = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(configPath, 'utf8')) };
  } catch {
    config = { ...DEFAULTS };
  }
}

function save() {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

function get() {
  return config;
}

function set(patch) {
  Object.assign(config, patch);
  save();
}

function loadTokens() {
  try {
    const raw = fs.readFileSync(tokensPath);
    const json = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(raw)
      : raw.toString('utf8');
    return JSON.parse(json);
  } catch {
    return {};
  }
}

function saveTokens(all) {
  const json = JSON.stringify(all);
  const data = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(json)
    : Buffer.from(json, 'utf8');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(tokensPath, data);
}

function getTokens(email) {
  return loadTokens()[email] || null;
}

function setTokens(email, tok) {
  const all = loadTokens();
  all[email] = { ...(all[email] || {}), ...tok };
  saveTokens(all);
}

function deleteTokens(email) {
  const all = loadTokens();
  delete all[email];
  saveTokens(all);
}

// Effective visibility for a calendar entry from Google's calendarList.
function isCalendarVisible(email, cal) {
  const key = `${email}::${cal.id}`;
  if (key in config.visibility) return !!config.visibility[key];
  return cal.selected !== false;
}

function setCalendarVisibility(email, calendarId, visible) {
  config.visibility[`${email}::${calendarId}`] = !!visible;
  save();
}

function setLocalPriority(email, calendarId, eventId, priority) {
  const key = `${email}::${calendarId}::${eventId}`;
  if (!config.localPriorities) config.localPriorities = {};
  // store explicit 1s too — they override a calendar-level default
  if (priority >= 1 && priority <= 4) config.localPriorities[key] = priority;
  else delete config.localPriorities[key];
  save();
}

function getLocalPriority(email, calendarId, ev) {
  const lp = config.localPriorities || {};
  return lp[`${email}::${calendarId}::${ev.id}`]
    ?? (ev.recurringEventId ? lp[`${email}::${calendarId}::${ev.recurringEventId}`] : undefined);
}

function setCalendarPriority(email, calendarId, priority) {
  const key = `${email}::${calendarId}`;
  if (!config.calendarPriorities) config.calendarPriorities = {};
  if (priority > 1) config.calendarPriorities[key] = priority;
  else delete config.calendarPriorities[key]; // 1 = no default
  save();
}

function getCalendarPriority(email, calendarId) {
  return (config.calendarPriorities || {})[`${email}::${calendarId}`];
}

module.exports = {
  init, get, set,
  getTokens, setTokens, deleteTokens,
  isCalendarVisible, setCalendarVisibility,
  setLocalPriority, getLocalPriority,
  setCalendarPriority, getCalendarPriority,
};
