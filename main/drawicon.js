'use strict';
// Pure PNG icon drawing (no Electron dependency) — used at runtime and by
// scripts/make-icon.js to produce the installer .ico.
const zlib = require('zlib');

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function pngFromRGBA(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // no filter
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Signed-distance helper for a rounded rectangle.
function inRoundRect(x, y, rx, ry, rw, rh, rad) {
  if (x < rx || x >= rx + rw || y < ry || y >= ry + rh) return false;
  const cx = Math.max(rx + rad, Math.min(x, rx + rw - rad));
  const cy = Math.max(ry + rad, Math.min(y, ry + rh - rad));
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= rad * rad || (x >= rx + rad && x < rx + rw - rad) || (y >= ry + rad && y < ry + rh - rad);
}

function drawCalendar(size, { accent = [91, 124, 250], mono = false } = {}) {
  const px = Buffer.alloc(size * size * 4);
  const put = (x, y, r, g, b, a) => {
    const i = (y * size + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
  };
  const m = Math.round(size * 0.08);           // outer margin
  const bx = m, by = Math.round(size * 0.14);  // body origin
  const bw = size - m * 2, bh = size - by - m;
  const rad = Math.max(2, Math.round(size * 0.16));
  const headerH = Math.round(bh * 0.30);
  const [ar, ag, ab] = accent;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!inRoundRect(x, y, bx, by, bw, bh, rad)) continue;
      if (mono) {
        put(x, y, 255, 255, 255, y < by + headerH ? 255 : 90);
      } else if (y < by + headerH) {
        put(x, y, ar, ag, ab, 255);
      } else {
        put(x, y, 250, 250, 252, 255);
      }
    }
  }
  // binder rings
  const ringW = Math.max(2, Math.round(size * 0.07));
  const ringH = Math.round(size * 0.14);
  const ringY = Math.round(size * 0.06);
  for (const fx of [0.30, 0.62]) {
    const rx = Math.round(size * fx);
    for (let y = ringY; y < ringY + ringH && y < size; y++) {
      for (let x = rx; x < rx + ringW && x < size; x++) {
        if (mono) put(x, y, 255, 255, 255, 255);
        else put(x, y, 60, 66, 92, 255);
      }
    }
  }
  // event dots in body (skip for mono/small)
  if (!mono && size >= 32) {
    const dot = Math.max(2, Math.round(size * 0.10));
    const gap = Math.round(size * 0.20);
    const startX = bx + Math.round(bw * 0.16);
    const startY = by + headerH + Math.round(bh * 0.16);
    const colors = [[ar, ag, ab], [240, 130, 90], [90, 190, 140], [200, 200, 210]];
    let c = 0;
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 3; col++) {
        const ox = startX + col * gap, oy = startY + row * gap;
        if (oy + dot > by + bh - 2) continue;
        const [r, g, b] = colors[c++ % colors.length];
        for (let y = oy; y < oy + dot; y++)
          for (let x = ox; x < ox + dot; x++)
            if (x < size && y < size) put(x, y, r, g, b, 255);
      }
    }
  }
  return pngFromRGBA(size, size, px);
}

// Wrap one or more PNGs (PNG-in-ICO, valid since Vista) into an .ico container.
function icoFromPngs(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // icon
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  const blobs = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, png } of pngs) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4);  // planes
    e.writeUInt16LE(32, 6); // bpp
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    entries.push(e);
    blobs.push(png);
  }
  return Buffer.concat([header, ...entries, ...blobs]);
}

module.exports = { drawCalendar, icoFromPngs };
