import * as D from './dates.js';
import { textOn } from './colors.js';
import { priorityFlag } from './priority.js';
import { overlayEvents } from './overlay.js';

const MAX_CHIPS = 4;

export function renderMonth(root, ctx) {
  const { state } = ctx;
  const first = new Date(state.cursor.getFullYear(), state.cursor.getMonth(), 1);
  const gridStart = D.startOfWeek(first, state.weekStart);
  const today = D.startOfDay(new Date());

  // bucket items by day key (including "meet with" overlay events)
  const byDay = new Map();
  const all = [
    ...state.items.events,
    ...state.items.tasks.filter((t) => t.due),
    ...overlayEvents(state),
  ];
  for (const item of all) {
    for (const key of D.itemDayKeys(item)) {
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(item);
    }
  }

  const wrap = document.createElement('div');
  wrap.className = 'month';

  const head = document.createElement('div');
  head.className = 'month-head';
  for (let i = 0; i < 7; i++) {
    const d = D.addDays(gridStart, i);
    const c = document.createElement('div');
    c.textContent = d.toLocaleDateString([], { weekday: 'short' });
    head.appendChild(c);
  }
  wrap.appendChild(head);

  const grid = document.createElement('div');
  grid.className = 'month-grid';

  for (let i = 0; i < 42; i++) {
    const date = D.addDays(gridStart, i);
    const key = D.dateKey(date);
    const cell = document.createElement('div');
    cell.className = 'month-cell';
    if (date.getMonth() !== state.cursor.getMonth()) cell.classList.add('other');
    if (D.sameDay(date, today)) cell.classList.add('today');

    const num = document.createElement('button');
    num.className = 'day-num';
    num.textContent = date.getDate() === 1
      ? date.toLocaleDateString([], { month: 'short', day: 'numeric' })
      : date.getDate();
    num.onclick = (e) => { e.stopPropagation(); ctx.onDayClick(date); };
    cell.appendChild(num);

    const items = D.sortDayItems(byDay.get(key) || []);
    const shown = items.length > MAX_CHIPS ? items.slice(0, MAX_CHIPS - 1) : items;
    for (const item of shown) cell.appendChild(chip(item, ctx));
    if (items.length > shown.length) {
      const more = document.createElement('button');
      more.className = 'chip more';
      more.textContent = `+${items.length - shown.length} more`;
      more.onclick = (e) => { e.stopPropagation(); ctx.onDayClick(date); };
      cell.appendChild(more);
    }

    // free/busy-only people (no shared details): one dot per busy day
    const busyPeople = (ctx.state.meetWith || []).filter((p) =>
      !p.detailed && (p.busy || []).some((b) => {
        const s = new Date(b.start), e = new Date(b.end);
        return s < D.addDays(date, 1) && e > date;
      }));
    if (busyPeople.length) {
      const row = document.createElement('div');
      row.className = 'month-busy';
      for (const p of busyPeople) {
        const d = document.createElement('span');
        d.style.background = p.color;
        d.title = `${p.name || p.email} is busy this day`;
        row.appendChild(d);
      }
      cell.appendChild(row);
    }

    // Google-style: clicking empty space in a day opens the create dialog.
    cell.addEventListener('click', () => ctx.onDayCreate(date));
    grid.appendChild(cell);
  }
  wrap.appendChild(grid);
  root.appendChild(wrap);
}

function chip(item, ctx) {
  const el = document.createElement('button');
  el.className = 'chip';
  if (item.overlay) el.classList.add('overlay');
  if (item.kind === 'task') {
    el.classList.add('task');
    if (item.completed) el.classList.add('done');
    el.innerHTML = `<span class="chip-check">${item.completed ? '☑' : '☐'}</span><span class="chip-title"></span>`;
    el.querySelector('.chip-title').textContent = item.title;
  } else if (item.allDay) {
    el.classList.add('allday');
    el.style.setProperty('--c', item.color);
    el.style.color = textOn(item.color);
    el.innerHTML = `<span class="chip-title"></span>`;
    el.querySelector('.chip-title').textContent = item.summary;
  } else {
    el.style.setProperty('--c', item.color);
    const t = D.parseWhen(item.start);
    el.innerHTML = `<span class="chip-dot"></span><span class="chip-time"></span><span class="chip-title"></span>`;
    el.querySelector('.chip-time').textContent = D.fmtTime(t);
    el.querySelector('.chip-title').textContent = item.summary;
  }
  if (item.kind === 'event') {
    const flag = priorityFlag(item);
    if (flag) el.appendChild(flag);
  }
  el.onclick = (e) => { e.stopPropagation(); ctx.onItemClick(item, el); };
  return el;
}
