'use strict';
const { nativeImage } = require('electron');
const { drawCalendar } = require('./drawicon');

function appIcon(size = 256) {
  return nativeImage.createFromBuffer(drawCalendar(size));
}
function trayIcon() {
  return nativeImage.createFromBuffer(drawCalendar(16, { mono: true }));
}

module.exports = { appIcon, trayIcon };
