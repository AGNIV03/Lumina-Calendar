// Pick a readable text color for a given background (fixes pale calendar
// colors like Google's birthday light-blue).
export function textOn(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '#fff';
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  // relative luminance (sRGB)
  const lin = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return L > 0.42 ? '#1b1e2b' : '#ffffff';
}

// Colors for "Meet with" overlay people.
export const MEET_COLORS = ['#a48ddb', '#d98bb1', '#7fb7a3', '#c9a86b'];
