// "Meet with" overlay events, colored per person. Shared meetings appear
// twice on purpose (your copy + theirs), matching Google Calendar.
export function overlayEvents(state) {
  const out = [];
  for (const p of state.meetWith || []) {
    for (const e of p.events || []) {
      out.push({
        ...e,
        color: p.color,
        calendarSummary: p.name || p.email,
        personEmail: p.email,
      });
    }
  }
  return out;
}
