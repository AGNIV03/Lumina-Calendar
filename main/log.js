'use strict';
// Tiny file logger (userData/lumina.log) so field issues are diagnosable.
const fs = require('fs');
const os = require('os');
const path = require('path');

let file = null;

// Black-box boot recorder: writes to %TEMP% (a different folder tree than the
// main log) so startup failures are captured even when the profile dir is the
// thing that's broken.
const BOOT_FILE = path.join(os.tmpdir(), 'lumina-boot.log');
function boot(msg) {
  const line = `[${new Date().toISOString()}] [pid ${process.pid}] ${msg}\n`;
  try { fs.appendFileSync(BOOT_FILE, line); } catch {}
  try { if (file) fs.appendFileSync(file, line); } catch {}
}

function init(dir) {
  file = path.join(dir, 'lumina.log');
  try {
    if (fs.existsSync(file) && fs.statSync(file).size > 512 * 1024) fs.unlinkSync(file);
  } catch {}
}

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args
    .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
    .join(' ')}\n`;
  try { if (file) fs.appendFileSync(file, line); } catch {}
  try { console.log(...args); } catch {} // stdout may be a broken pipe
}

module.exports = { init, log, boot };
