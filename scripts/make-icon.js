'use strict';
// Generates build/icon.ico for electron-builder (run with plain node).
const fs = require('fs');
const path = require('path');
const { drawCalendar, icoFromPngs } = require('../main/drawicon');

const sizes = [16, 24, 32, 48, 64, 128, 256];
const ico = icoFromPngs(sizes.map((size) => ({ size, png: drawCalendar(size) })));

const out = path.join(__dirname, '..', 'build');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'icon.ico'), ico);
console.log('wrote', path.join(out, 'icon.ico'), `${ico.length} bytes`);
