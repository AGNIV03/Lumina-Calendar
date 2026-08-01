// Event importance levels 1–4. Stored on the Google event itself
// (extendedProperties.private.luminaPriority) so it syncs everywhere.
export const PRIORITIES = {
  1: { color: '#7cc3f2', label: 'Normal',    days: 0 },  // widget: day-of only
  2: { color: '#e8c341', label: 'Notable',   days: 1 },  // 1 day prior
  3: { color: '#ef7fb1', label: 'Important', days: 7 },  // 1 week prior
  4: { color: '#e05252', label: 'Critical',  days: 30 }, // 1 month prior
};

export function priorityOf(item) {
  const p = Number(item?.priority);
  return p >= 1 && p <= 4 ? p : 1;
}

// Small colored flag; level 1 is the default and gets no marker.
export function priorityFlag(item, { force = false } = {}) {
  const p = priorityOf(item);
  if (p === 1 && !force) return null;
  const el = document.createElement('span');
  el.className = 'prio-flag';
  el.style.color = PRIORITIES[p].color;
  el.textContent = '⚑';
  el.title = `${PRIORITIES[p].label} (level ${p})`;
  return el;
}
