'use strict';
// Desktop widget: frameless translucent window pinned to the BOTTOM of the
// z-order so it lives on the desktop and never covers other apps.
const { BrowserWindow, screen } = require('electron');
const path = require('path');
const store = require('./store');

let widgetWin = null;
let SetWindowPos = null;

try {
  const koffi = require('koffi');
  const user32 = koffi.load('user32.dll');
  SetWindowPos = user32.func('bool __stdcall SetWindowPos(int64 hWnd, int64 hWndInsertAfter, int x, int y, int cx, int cy, uint32 uFlags)');
} catch (e) {
  console.warn('koffi unavailable, widget z-order pinning disabled:', e.message);
}

const HWND_BOTTOM = 1n;
const SWP_NOSIZE = 0x0001, SWP_NOMOVE = 0x0002, SWP_NOACTIVATE = 0x0010;

function sendToBottom(win) {
  if (!SetWindowPos || !win || win.isDestroyed()) return;
  try {
    const buf = win.getNativeWindowHandle();
    const hwnd = buf.length >= 8 ? buf.readBigInt64LE(0) : BigInt(buf.readInt32LE(0));
    SetWindowPos(hwnd, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE);
  } catch {}
}

function defaultBounds() {
  const { workArea } = screen.getPrimaryDisplay();
  return { x: workArea.x + workArea.width - 360, y: workArea.y + 24 };
}

function createWidget() {
  if (widgetWin && !widgetWin.isDestroyed()) {
    widgetWin.show();
    sendToBottom(widgetWin);
    return widgetWin;
  }
  const saved = store.get().widgetBounds || defaultBounds();
  widgetWin = new BrowserWindow({
    width: 336,
    height: 500,
    x: saved.x,
    y: saved.y,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  widgetWin.loadFile(path.join(__dirname, '..', 'renderer', 'widget.html'));
  widgetWin.once('ready-to-show', () => {
    widgetWin.showInactive();
    sendToBottom(widgetWin);
  });
  // Whenever it gains focus (user clicked it), let it interact but keep it
  // below other windows.
  widgetWin.on('focus', () => sendToBottom(widgetWin));
  widgetWin.on('moved', () => {
    if (!widgetWin || widgetWin.isDestroyed()) return;
    const [x, y] = widgetWin.getPosition();
    store.set({ widgetBounds: { x, y } });
    sendToBottom(widgetWin);
  });
  widgetWin.on('closed', () => { widgetWin = null; });
  return widgetWin;
}

function destroyWidget() {
  if (widgetWin && !widgetWin.isDestroyed()) widgetWin.destroy();
  widgetWin = null;
}

function setEnabled(enabled) {
  store.set({ widgetEnabled: !!enabled });
  if (enabled) createWidget();
  else destroyWidget();
}

function getWindow() {
  return widgetWin && !widgetWin.isDestroyed() ? widgetWin : null;
}

module.exports = { createWidget, destroyWidget, setEnabled, getWindow, sendToBottom };
