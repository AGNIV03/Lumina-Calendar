import { state } from './app.js';

// Email suggestions gathered from saved contacts + guests of loaded events.
export function suggestionEmails() {
  const set = new Set();
  for (const c of state.savedContacts) set.add(c.email);
  for (const ev of state.items.events) {
    for (const a of ev.attendees || []) {
      if (a.email && !a.self) set.add(a.email.toLowerCase());
    }
  }
  const own = new Set(state.accounts.map((a) => a.email.toLowerCase()));
  return [...set].filter((e) => !own.has(e)).sort().slice(0, 40);
}

export function contactName(email) {
  return state.savedContacts.find((c) => c.email === email)?.name || '';
}

// Debounced location autocomplete via OpenStreetMap Nominatim (keyless).
let locTimer = null;
export function wireLocationSuggest(input, datalist) {
  input.addEventListener('input', () => {
    clearTimeout(locTimer);
    const q = input.value.trim();
    if (q.length < 3) return;
    locTimer = setTimeout(async () => {
      try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(q)}`;
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!res.ok) return;
        const places = await res.json();
        datalist.innerHTML = '';
        for (const p of places) {
          const o = document.createElement('option');
          o.value = p.display_name;
          datalist.appendChild(o);
        }
      } catch { /* offline or rate-limited — fine, it's just suggestions */ }
    }, 400);
  });
}

export function mapsUrl(location) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;
}
