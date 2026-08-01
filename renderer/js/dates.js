// Local-time date helpers shared by all views.

export const MS_DAY = 86400000;

export function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function addMonths(d, n) {
  const x = new Date(d);
  const day = x.getDate();
  x.setDate(1);
  x.setMonth(x.getMonth() + n);
  x.setDate(Math.min(day, daysInMonth(x)));
  return x;
}

export function daysInMonth(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

export function startOfWeek(d, weekStart = 1) {
  const x = startOfDay(d);
  const diff = (x.getDay() - weekStart + 7) % 7;
  return addDays(x, -diff);
}

export function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// Parse an item's start/end. All-day values are 'YYYY-MM-DD' (parse as local).
export function parseWhen(value) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(value);
}

export function fmtTime(d) {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function fmtDayLong(d) {
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

export function fmtDayShort(d) {
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

export function fmtMonthYear(d) {
  return d.toLocaleDateString([], { month: 'long', year: 'numeric' });
}

export function toLocalInputDate(d) {
  return dateKey(d);
}

export function toLocalInputTime(d) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// Every local date key an item touches (multi-day aware). End is exclusive.
export function itemDayKeys(item) {
  const keys = [];
  const start = parseWhen(item.kind === 'task' ? item.due : item.start);
  if (!start) return keys;
  let end;
  if (item.kind === 'task') {
    end = addDays(startOfDay(start), 1);
  } else {
    end = parseWhen(item.end) || addDays(startOfDay(start), 1);
    // exclusive end: an event ending exactly at midnight doesn't touch that day
    if (end <= start) end = new Date(start.getTime() + 1);
  }
  let cur = startOfDay(start);
  while (cur < end) {
    keys.push(dateKey(cur));
    cur = addDays(cur, 1);
  }
  return keys;
}

export function itemSortValue(item) {
  if (item.kind === 'task') return item.completed ? 2 : 1; // tasks after all-day events
  if (item.allDay) return 0;
  return 3 + parseWhen(item.start).getHours() / 100 + parseWhen(item.start).getMinutes() / 10000;
}

export function sortDayItems(items) {
  return items.slice().sort((a, b) => {
    const va = itemSortValue(a), vb = itemSortValue(b);
    if (va !== vb) return va - vb;
    if (a.kind === 'event' && b.kind === 'event' && !a.allDay && !b.allDay) {
      return parseWhen(a.start) - parseWhen(b.start);
    }
    return (a.summary || a.title || '').localeCompare(b.summary || b.title || '');
  });
}
