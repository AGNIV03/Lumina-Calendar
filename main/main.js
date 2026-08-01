'use strict';
const { app, BrowserWindow, Tray, Menu, ipcMain, shell, nativeTheme } = require('electron');
const path = require('path');
const store = require('./store');
const oauth = require('./oauth');
const google = require('./google');
const sync = require('./sync');
const widgets = require('./widgets');
const demo = require('./demo');
const { appIcon, trayIcon } = require('./icon');

const IS_DEMO = process.argv.includes('--demo');
const START_HIDDEN = process.argv.includes('--hidden');
const SMOKE = process.argv.includes('--smoke');

let mainWin = null;
let tray = null;
let quitting = false;

// Demo/smoke runs get an isolated profile and may coexist with the real app.
if (IS_DEMO || SMOKE) {
  app.setPath('userData', path.join(require('os').tmpdir(), 'lumina-demo-data'));
} else {
  // Same profile in dev and packaged builds, so installing keeps all sign-ins.
  app.setPath('userData', path.join(app.getPath('appData'), 'lumina-calendar'));
}
if (!IS_DEMO && !SMOKE && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showMainWindow());
}

app.setAppUserModelId('eco.regenesis.luminacalendar');

const isWin11 = () => {
  try { return parseInt(process.getSystemVersion().split('.')[2], 10) >= 22000; }
  catch { return false; }
};

function showMainWindow() {
  if (mainWin && !mainWin.isDestroyed()) {
    if (mainWin.isMinimized()) mainWin.restore();
    mainWin.show();
    mainWin.focus();
    return mainWin;
  }
  return createMainWindow();
}

function createMainWindow() {
  const win11 = isWin11();
  mainWin = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 860,
    minHeight: 560,
    show: false,
    icon: appIcon(),
    backgroundColor: win11 ? undefined : (nativeTheme.shouldUseDarkColors ? '#16181f' : '#f5f6fa'),
    ...(win11 ? { backgroundMaterial: 'acrylic' } : {}),
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#00000000',
      symbolColor: nativeTheme.shouldUseDarkColors ? '#e8eaf2' : '#3a3f52',
      height: 42,
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  mainWin.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWin.once('ready-to-show', () => {
    if (!START_HIDDEN) mainWin.show();
  });
  // Close hides to tray; app keeps syncing the widget.
  mainWin.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      mainWin.hide();
    }
  });
  mainWin.on('closed', () => { mainWin = null; });

  nativeTheme.on('updated', () => {
    if (mainWin && !mainWin.isDestroyed()) {
      try {
        mainWin.setTitleBarOverlay({
          color: '#00000000',
          symbolColor: nativeTheme.shouldUseDarkColors ? '#e8eaf2' : '#3a3f52',
          height: 42,
        });
      } catch {}
    }
  });

  if (SMOKE) {
    mainWin.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const view = process.env.SMOKE_VIEW;
          if (view) {
            await mainWin.webContents.executeJavaScript(
              `document.querySelector('#view-switcher [data-view="${view}"]')?.click()`);
            await new Promise((r) => setTimeout(r, 900));
          }
          if (process.env.SMOKE_JS) {
            await mainWin.webContents.executeJavaScript(process.env.SMOKE_JS);
            await new Promise((r) => setTimeout(r, 1200));
          }
          const img = await mainWin.webContents.capturePage();
          const out = process.env.SMOKE_OUT || path.join(app.getPath('temp'), 'lumina-smoke.png');
          require('fs').writeFileSync(out, img.toPNG());
          console.log('SMOKE_SAVED', out);
          const w = widgets.getWindow() || widgets.createWidget();
          await new Promise((r) => setTimeout(r, 1800));
          const wimg = await w.webContents.capturePage();
          const wout = out.replace(/\.png$/, '-widget.png');
          require('fs').writeFileSync(wout, wimg.toPNG());
          console.log('SMOKE_SAVED', wout);
        } catch (e) {
          console.error('SMOKE_FAILED', e);
        }
        quitting = true;
        app.quit();
      }, 2500);
    });
  }
  return mainWin;
}

function buildTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip('Lumina Calendar');
  const rebuild = () => {
    const cfg = store.get();
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open Lumina Calendar', click: () => showMainWindow() },
      { label: 'Refresh now', click: () => sync.refreshNow() },
      { type: 'separator' },
      {
        label: 'Desktop widget',
        type: 'checkbox',
        checked: cfg.widgetEnabled,
        click: (item) => { widgets.setEnabled(item.checked); rebuild(); },
      },
      {
        label: 'Launch at startup',
        type: 'checkbox',
        checked: cfg.launchAtStartup,
        click: (item) => { setLaunchAtStartup(item.checked); rebuild(); },
      },
      { type: 'separator' },
      { label: 'Quit', click: () => { quitting = true; app.quit(); } },
    ]));
  };
  rebuild();
  tray.on('double-click', () => showMainWindow());
}

function setLaunchAtStartup(enabled) {
  store.set({ launchAtStartup: !!enabled });
  if (!app.isPackaged) return; // avoid registering the dev electron.exe
  app.setLoginItemSettings({
    openAtLogin: !!enabled,
    args: ['--hidden'],
  });
}

function broadcastDataChanged() {
  for (const wc of require('electron').webContents.getAllWebContents()) {
    try { wc.send('data-changed'); } catch {}
  }
}

// End a recurring series just before `instanceStart` (RFC 5545 UNTIL).
function setRuleUntil(rrule, instanceStart, allDay) {
  const cleaned = rrule
    .replace(/;?UNTIL=[^;]*/i, '')
    .replace(/;?COUNT=\d+/i, '');
  let until;
  if (allDay) {
    const d = new Date(`${instanceStart}T00:00:00`);
    d.setDate(d.getDate() - 1);
    until = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  } else {
    const t = new Date(new Date(instanceStart).getTime() - 1000);
    until = t.toISOString().replace(/[-:]|\.\d{3}/g, '');
  }
  return `${cleaned};UNTIL=${until}`;
}

// ---- IPC ----
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, arg) => {
    try {
      return { ok: true, data: await fn(arg, event) };
    } catch (err) {
      console.error(`[ipc:${channel}]`, err);
      return { ok: false, error: err.message || String(err) };
    }
  });
}

function registerIpc() {
  handle('state:get', async () => {
    const cfg = store.get();
    return {
      demo: IS_DEMO,
      hasCredentials: IS_DEMO || (!!cfg.clientId && !!cfg.clientSecret),
      accounts: IS_DEMO ? demo.accounts() : cfg.accounts,
      clientId: cfg.clientId,
      widgetEnabled: cfg.widgetEnabled,
      launchAtStartup: cfg.launchAtStartup,
      weekStart: cfg.weekStart,
      savedContacts: cfg.savedContacts,
      calendars: await sync.getCalendars().catch(() => []),
    };
  });

  handle('creds:set', ({ clientId, clientSecret }) => {
    const patch = { clientId: (clientId || '').trim() };
    // leaving the secret blank keeps the previously saved one
    if (clientSecret) patch.clientSecret = clientSecret.trim();
    store.set(patch);
    return true;
  });

  handle('account:add', async () => {
    const cfg = store.get();
    if (!cfg.clientId || !cfg.clientSecret) {
      throw new Error('Add your Google OAuth Client ID and Secret in Settings first.');
    }
    const result = await oauth.authorize(cfg.clientId, cfg.clientSecret);
    const { email, name, picture, ...tokens } = result;
    store.setTokens(email, tokens);
    const accounts = cfg.accounts.filter((a) => a.email !== email);
    accounts.push({ email, name, picture });
    store.set({ accounts });
    await sync.refreshNow();
    return { email, name };
  });

  handle('account:remove', async (email) => {
    const cfg = store.get();
    store.set({ accounts: cfg.accounts.filter((a) => a.email !== email) });
    store.deleteTokens(email);
    await sync.refreshNow();
    return true;
  });

  handle('calendars:list', ({ force } = {}) => sync.getCalendars(!!force));

  handle('calendar:priority', ({ accountEmail, calendarId, priority }) => {
    store.setCalendarPriority(accountEmail, calendarId, Number(priority) || 1);
    sync.invalidate();
    broadcastDataChanged();
    return true;
  });

  handle('calendar:visibility', ({ accountEmail, calendarId, visible }) => {
    store.setCalendarVisibility(accountEmail, calendarId, visible);
    sync.invalidate();
    broadcastDataChanged();
    return true;
  });

  handle('items:get', (p) => sync.getItems(p || {}));

  handle('event:create', async ({ accountEmail, calendarId, resource, opts }) => {
    const created = await google.insertEvent(accountEmail, calendarId, resource, opts || {});
    sync.invalidate();
    broadcastDataChanged();
    return created;
  });

  handle('event:update', async ({ accountEmail, calendarId, eventId, patch, opts }) => {
    const updated = await google.patchEvent(accountEmail, calendarId, eventId, patch, opts || {});
    sync.invalidate();
    broadcastDataChanged();
    return updated;
  });

  handle('freebusy:query', (p) => sync.meetWithSchedule(p));

  // priority for locked event types (birthday, out-of-office, Gmail events):
  // Google rejects extendedProperties on them, so it lives in local config
  handle('priority:set-local', ({ accountEmail, calendarId, eventId, priority }) => {
    store.setLocalPriority(accountEmail, calendarId, eventId, Number(priority) || 1);
    sync.invalidate();
    broadcastDataChanged();
    return true;
  });

  handle('contacts:add', ({ email, name }) => {
    const cfg = store.get();
    const cleaned = (email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned)) throw new Error('Enter a valid email address.');
    const contacts = cfg.savedContacts.filter((c) => c.email !== cleaned);
    contacts.push({ email: cleaned, name: (name || '').trim() });
    contacts.sort((a, b) => a.email.localeCompare(b.email));
    store.set({ savedContacts: contacts });
    return contacts;
  });

  handle('contacts:remove', (email) => {
    const cfg = store.get();
    const contacts = cfg.savedContacts.filter((c) => c.email !== email);
    store.set({ savedContacts: contacts });
    return contacts;
  });

  // scope: 'single' | 'following' | 'all' (recurring); plain delete otherwise
  handle('event:delete', async ({ accountEmail, calendarId, eventId, scope, recurringEventId, instanceStart, allDay }) => {
    if (scope === 'all' && recurringEventId) {
      await google.deleteEvent(accountEmail, calendarId, recurringEventId);
    } else if (scope === 'following' && recurringEventId) {
      const master = await google.getEvent(accountEmail, calendarId, recurringEventId);
      const recurrence = (master.recurrence || []).map((r) =>
        r.startsWith('RRULE:') ? setRuleUntil(r, instanceStart, allDay) : r);
      if (!recurrence.some((r) => r.startsWith('RRULE:'))) {
        throw new Error('Could not update the recurrence rule for this series.');
      }
      await google.patchEvent(accountEmail, calendarId, recurringEventId, { recurrence });
    } else {
      await google.deleteEvent(accountEmail, calendarId, eventId);
    }
    sync.invalidate();
    broadcastDataChanged();
    return true;
  });

  handle('tasklists:get', () => sync.getTaskLists());

  handle('task:create', async ({ accountEmail, tasklistId, resource }) => {
    const created = await google.insertTask(accountEmail, tasklistId, resource);
    sync.invalidate();
    broadcastDataChanged();
    return created;
  });

  handle('task:toggle', async ({ accountEmail, tasklistId, taskId, completed }) => {
    const patch = completed
      ? { status: 'completed' }
      : { status: 'needsAction', completed: null };
    const updated = await google.patchTask(accountEmail, tasklistId, taskId, patch);
    sync.invalidate();
    broadcastDataChanged();
    return updated;
  });

  handle('task:delete', async ({ accountEmail, tasklistId, taskId }) => {
    await google.deleteTask(accountEmail, tasklistId, taskId);
    sync.invalidate();
    broadcastDataChanged();
    return true;
  });

  handle('widget:set-enabled', (enabled) => {
    widgets.setEnabled(enabled);
    return true;
  });

  handle('settings:launch-at-startup', (enabled) => {
    setLaunchAtStartup(enabled);
    return true;
  });

  handle('sync:refresh', () => sync.refreshNow());

  handle('app:open-main', () => { showMainWindow(); return true; });

  handle('external:open', (url) => {
    if (typeof url === 'string' && /^https:\/\//i.test(url)) shell.openExternal(url);
    return true;
  });
}

app.whenReady().then(() => {
  store.init();
  registerIpc();
  sync.setBroadcast(broadcastDataChanged);
  sync.startTimer();
  buildTray();
  createMainWindow();
  if (store.get().widgetEnabled && !SMOKE) widgets.createWidget();
});

app.on('before-quit', () => { quitting = true; });

// Keep running in the tray when all windows are closed.
app.on('window-all-closed', () => {
  if (quitting) app.quit();
});

app.on('activate', () => showMainWindow());
