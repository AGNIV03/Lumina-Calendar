'use strict';
// Config + encrypted token storage in the Electron userData directory.
const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const logger = require('./log');

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
  cachedCalendars: [],    // last successfully fetched calendar list (offline fallback)
  launchAtStartup: false,
  weekStart: 1,        // 1 = Monday, 0 = Sunday
};

let dir = null;
let configPath = null;
let tokensPath = null;
let config = null;

// Degraded mode: the config/token files exist but could not be read — on
// EFS-encrypted profiles this happens when the app auto-starts at login
// before Windows has loaded the user's encryption keys. While degraded we
// block every save (so an empty in-memory config can never clobber the real
// file) and keep retrying the read until it succeeds.
let configDegraded = false;
let tokensDegraded = false;
let onRecoveredFn = null;

function onRecovered(fn) { onRecoveredFn = fn; }
function isDegraded() { return configDegraded || tokensDegraded; }

function scheduleConfigRetry() {
  const timer = setInterval(() => {
    try {
      const loaded = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      config = { ...DEFAULTS, ...loaded };
      configDegraded = false;
      clearInterval(timer);
      logger.log(`config recovered after startup race: ${config.accounts.length} account(s)`);
      try { onRecoveredFn?.(); } catch {}
    } catch { /* keys still not loaded — keep trying */ }
  }, 5000);
}

function init() {
  dir = app.getPath('userData');
  fs.mkdirSync(dir, { recursive: true });
  logger.init(dir);
  configPath = path.join(dir, 'config.json');
  tokensPath = path.join(dir, 'tokens.dat');
  let loaded = null;
  try {
    loaded = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    logger.boot(`config read OK (${JSON.stringify(loaded.accounts?.length)} accounts)`);
  } catch (e1) {
    logger.boot(`config read FAILED: code=${e1.code} ${e1.message}`);
    // main file unreadable — a stranded .tmp from an interrupted save may
    // hold the newest good copy
    try {
      loaded = JSON.parse(fs.readFileSync(`${configPath}.tmp`, 'utf8'));
      logger.log('config.json unreadable, recovered from config.json.tmp');
    } catch {
      let exists = true;
      try { exists = fs.existsSync(configPath); } catch {}
      if (exists) {
        // real data is there but unreadable (EFS keys not loaded yet at
        // login): run degraded, keep retrying, never save over it
        configDegraded = true;
        logger.log('config.json exists but is unreadable — degraded start, retrying:', e1.message);
        scheduleConfigRetry();
      }
    }
  }
  config = { ...DEFAULTS, ...(loaded || {}) };
  logger.log(`store loaded: ${config.accounts.length} account(s), creds=${!!config.clientId}${configDegraded ? ' (DEGRADED)' : ''}`);
  // clean up stranded temp files from interrupted saves
  if (!configDegraded) {
    for (const f of [`${configPath}.tmp`, `${tokensPath}.tmp`]) {
      try { fs.unlinkSync(f); } catch {}
    }
  }
}

// Safest-possible write: temp file + rename when the OS allows it. Some
// Windows setups (EFS-encrypted profiles) reject even same-folder renames
// with EXDEV, so fall back to copy+delete, then to a plain direct write.
// This must never throw for a recoverable reason — a failed save must not
// take down callers like the token-refresh path.
function writeFileAtomic(file, data) {
  const tmp = `${file}.tmp`;
  try {
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, file);
    return;
  } catch (e) {
    logger.log(`atomic rename failed for ${path.basename(file)} (${e.code}), using fallback`);
  }
  try {
    fs.copyFileSync(tmp, file);
    fs.unlinkSync(tmp);
    return;
  } catch {}
  fs.writeFileSync(file, data);
  try { fs.unlinkSync(tmp); } catch {}
}

function save() {
  if (configDegraded) {
    logger.log('config save SKIPPED: real file is unreadable (degraded start)');
    return;
  }
  fs.mkdirSync(dir, { recursive: true });
  writeFileAtomic(configPath, JSON.stringify(config, null, 2));
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
    const parsed = JSON.parse(json);
    if (tokensDegraded) {
      tokensDegraded = false;
      logger.log('tokens recovered after startup race');
    }
    return parsed;
  } catch (e) {
    let exists = false;
    try { exists = fs.existsSync(tokensPath); } catch {}
    if (exists && !tokensDegraded) {
      tokensDegraded = true;
      logger.log('tokens.dat exists but is unreadable — degraded, will retry:', e.message);
    }
    return {};
  }
}

function saveTokens(all) {
  if (tokensDegraded) {
    logger.log('token save SKIPPED: real file is unreadable (degraded start)');
    return;
  }
  const json = JSON.stringify(all);
  const data = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(json)
    : Buffer.from(json, 'utf8');
  fs.mkdirSync(dir, { recursive: true });
  writeFileAtomic(tokensPath, data);
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
  isDegraded, onRecovered,
  getTokens, setTokens, deleteTokens,
  isCalendarVisible, setCalendarVisibility,
  setLocalPriority, getLocalPriority,
  setCalendarPriority, getCalendarPriority,
};
