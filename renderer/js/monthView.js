import * as D from './dates.js';
import { textOn } from './colors.js';
import { priorityFlag } from './priority.js';
import { overlayEvents } from './overlay.js';

const LANE_H = 20; // px per spanning-bar lane

function el(tag, cls) {
  const x = document.createElement(tag);
  if (cls) x.className = cls;
  return x;
}

export function renderMonth(root, ctx) {
  const { state } = ctx;
  const first = new Date(state.cursor.getFullYear(), state.cursor.getMonth(), 1);
  const gridStart = D.startOfWeek(first, state.weekStart);
  const today = D.startOfDay(new Date());

  // Split events: multi-day ones become continuous spanning bars per week
  // (Google-style); single-day events and tasks stay as per-day chips.
  const all = [...state.items.events, ...overlayEvents(state)];
  const spans = [];
  const byDay = new Map();
  const push = (key, item) => {
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(item);
  };
  for (const item of all) {
    const keys = D.itemDayKeys(item);
    if (keys.length > 1) spans.push({ item, keys });
    else for (const k of keys) push(k, item);
  }
  for (const t of state.items.tasks.filter((x) => x.due)) {
    for (const k of D.itemDayKeys(t)) push(k, t);
  }

  const wrap = el('div', 'month');
  const head = el('div', 'month-head');
  for (let i = 0; i < 7; i++) {
    const d = D.addDays(gridStart, i);
    const c = el('div');
    c.textContent = d.toLocaleDateString([], { weekday: 'short' });
    head.appendChild(c);
  }
  wrap.appendChild(head);

  const grid = el('div', 'month-grid');
  for (let w = 0; w < 6; w++) {
    grid.appendChild(weekRow(w, gridStart, today, spans, byDay, ctx));
  }
  wrap.appendChild(grid);
  root.appendChild(wrap);
}

function weekRow(w, gridStart, today, spans, byDay, ctx) {
  const { state } = ctx;
  const days = Array.from({ length: 7 }, (_, i) => D.addDays(gridStart, w * 7 + i));
  const weekKeys = days.map(D.dateKey);

  const week = el('div', 'month-week');

  // vertical day separators behind everything
  const bg = el('div', 'week-bg');
  for (let i = 0; i < 7; i++) bg.appendChild(el('div'));
  week.appendChild(bg);

  // day numbers
  const headRow = el('div', 'week-head');
  for (const date of days) {
    const cell = el('div', 'wh-cell');
    if (date.getMonth() !== state.cursor.getMonth()) cell.classList.add('other');
    if (D.sameDay(date, today)) cell.classList.add('today');
    const num = document.createElement('button');
    num.className = 'day-num';
    num.textContent = date.getDate() === 1
      ? date.toLocaleDateString([], { month: 'short', day: 'numeric' })
      : date.getDate();
    num.onclick = (e) => { e.stopPropagation(); ctx.onDayClick(date); };
    cell.appendChild(num);
    cell.onclick = () => ctx.onDayCreate(date);
    headRow.appendChild(cell);
  }
  week.appendChild(headRow);

  // spanning bars, clipped to this week and packed into lanes
  const segs = [];
  for (const sp of spans) {
    const idxs = [];
    for (const k of sp.keys) {
      const i = weekKeys.indexOf(k);
      if (i >= 0) idxs.push(i);
    }
    if (!idxs.length) continue;
    const c0 = Math.min(...idxs), c1 = Math.max(...idxs);
    segs.push({
      item: sp.item, c0, c1,
      startsHere: sp.keys[0] === weekKeys[c0],
      endsHere: sp.keys[sp.keys.length - 1] === weekKeys[c1],
    });
  }
  segs.sort((a, b) => a.c0 - b.c0 || (b.c1 - b.c0) - (a.c1 - a.c0));
  const laneEnds = [];
  for (const s of segs) {
    let lane = laneEnds.findIndex((end) => end < s.c0);
    if (lane < 0) { lane = laneEnds.length; laneEnds.push(-1); }
    laneEnds[lane] = s.c1;
    s.lane = lane;
  }
  const lanes = laneEnds.length;
  if (lanes) {
    const spansEl = el('div', 'week-spans');
    spansEl.style.height = `${lanes * LANE_H}px`;
    for (const s of segs) spansEl.appendChild(spanBar(s, ctx));
    week.appendChild(spansEl);
  }

  // single-day chips (fewer fit when spanning lanes take up room)
  const maxChips = Math.max(1, 4 - lanes);
  const cells = el('div', 'week-cells');
  for (const date of days) {
    const cell = el('div', 'month-cell');
    if (date.getMonth() !== state.cursor.getMonth()) cell.classList.add('other');
    const items = D.sortDayItems(byDay.get(D.dateKey(date)) || []);
    const shown = items.length > maxChips ? items.slice(0, maxChips - 1) : items;
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
      const row = el('div', 'month-busy');
      for (const p of busyPeople) {
        const dot = el('span');
        dot.style.background = p.color;
        dot.title = `${p.name || p.email} is busy this day`;
        row.appendChild(dot);
      }
      cell.appendChild(row);
    }

    cell.addEventListener('click', () => ctx.onDayCreate(date));
    cells.appendChild(cell);
  }
  week.appendChild(cells);
  return week;
}

function spanBar(seg, ctx) {
  const b = document.createElement('button');
  b.className = 'span-bar';
  const { item } = seg;
  b.style.setProperty('--c', item.color);
  if (item.overlay) b.classList.add('overlay');
  else b.style.color = textOn(item.color);
  if (item.declined) b.classList.add('declined');
  if (seg.startsHere) b.classList.add('rl'); // real start: rounded left
  if (seg.endsHere) b.classList.add('rr');   // real end: rounded right
  const leftPct = (seg.c0 * 100) / 7;
  const widthPct = ((seg.c1 - seg.c0 + 1) * 100) / 7;
  const lp = seg.startsHere ? 3 : 0;
  const rp = seg.endsHere ? 3 : 0;
  b.style.left = `calc(${leftPct}% + ${lp}px)`;
  b.style.width = `calc(${widthPct}% - ${lp + rp}px)`;
  b.style.top = `${seg.lane * LANE_H}px`;
  const flag = priorityFlag(item);
  if (flag) b.appendChild(flag);
  const title = el('span', 'sb-title');
  title.textContent = (item.allDay ? '' : `${D.fmtTime(D.parseWhen(item.start))} `) + item.summary;
  b.appendChild(title);
  b.title = item.summary;
  b.onclick = (e) => { e.stopPropagation(); ctx.onItemClick(item, b); };
  return b;
}

function chip(item, ctx) {
  const el2 = document.createElement('button');
  el2.className = 'chip';
  if (item.overlay) el2.classList.add('overlay');
  if (item.declined) el2.classList.add('declined');
  if (item.kind === 'task') {
    el2.classList.add('task');
    if (item.completed) el2.classList.add('done');
    el2.innerHTML = `<span class="chip-check">${item.completed ? '☑' : '☐'}</span><span class="chip-title"></span>`;
    el2.querySelector('.chip-title').textContent = item.title;
  } else if (item.allDay) {
    el2.classList.add('allday');
    el2.style.setProperty('--c', item.color);
    el2.style.color = textOn(item.color);
    el2.innerHTML = `<span class="chip-title"></span>`;
    el2.querySelector('.chip-title').textContent = item.summary;
  } else {
    el2.style.setProperty('--c', item.color);
    const t = D.parseWhen(item.start);
    el2.innerHTML = `<span class="chip-dot"></span><span class="chip-time"></span><span class="chip-title"></span>`;
    el2.querySelector('.chip-time').textContent = D.fmtTime(t);
    el2.querySelector('.chip-title').textContent = item.summary;
  }
  if (item.kind === 'event') {
    const flag = priorityFlag(item);
    if (flag) el2.appendChild(flag);
  }
  el2.onclick = (e) => { e.stopPropagation(); ctx.onItemClick(item, el2); };
  return el2;
}
