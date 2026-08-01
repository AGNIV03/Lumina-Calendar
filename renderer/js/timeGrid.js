import * as D from './dates.js';
import { textOn } from './colors.js';
import { priorityFlag } from './priority.js';
import { overlayEvents } from './overlay.js';

const HOUR_PX = 52;

export function renderTimeGrid(root, ctx, numDays) {
  const { state } = ctx;
  const allEvents = [...state.items.events, ...overlayEvents(state)];
  const start = numDays === 1
    ? D.startOfDay(state.cursor)
    : D.startOfWeek(state.cursor, state.weekStart);
  const days = Array.from({ length: numDays }, (_, i) => D.addDays(start, i));
  const today = D.startOfDay(new Date());

  const wrap = document.createElement('div');
  wrap.className = 'timegrid';

  // ---- header: day names + all-day row ----
  const header = document.createElement('div');
  header.className = 'tg-header';
  header.appendChild(el('div', 'tg-gutter-head'));
  for (const d of days) {
    const h = el('div', 'tg-day-head');
    if (D.sameDay(d, today)) h.classList.add('today');
    const btn = document.createElement('button');
    btn.className = 'tg-day-label';
    btn.innerHTML = `<span class="dow">${d.toLocaleDateString([], { weekday: 'short' })}</span><span class="num">${d.getDate()}</span>`;
    btn.onclick = () => ctx.onDayClick(d);
    h.appendChild(btn);
    header.appendChild(h);
  }
  wrap.appendChild(header);

  // all-day / tasks row
  const byDayAll = bucketAllDay(state, days, allEvents);
  if ([...byDayAll.values()].some((v) => v.length)) {
    const adRow = el('div', 'tg-allday');
    adRow.appendChild(el('div', 'tg-gutter-head'));
    for (const d of days) {
      const cell = el('div', 'tg-allday-cell');
      for (const item of byDayAll.get(D.dateKey(d)) || []) {
        cell.appendChild(alldayChip(item, ctx));
      }
      adRow.appendChild(cell);
    }
    wrap.appendChild(adRow);
  }

  // ---- scrollable body ----
  const body = el('div', 'tg-body');
  const gutter = el('div', 'tg-gutter');
  for (let h = 0; h < 24; h++) {
    const lbl = el('div', 'tg-hour');
    lbl.style.top = `${h * HOUR_PX}px`;
    if (h > 0) {
      const dt = new Date();
      dt.setHours(h, 0);
      lbl.textContent = dt.toLocaleTimeString([], { hour: 'numeric' });
    }
    gutter.appendChild(lbl);
  }
  body.appendChild(gutter);

  for (const d of days) {
    const col = el('div', 'tg-col');
    if (D.sameDay(d, today)) col.classList.add('today');
    for (let h = 0; h < 24; h++) {
      const line = el('div', 'tg-line');
      line.style.top = `${h * HOUR_PX}px`;
      col.appendChild(line);
    }
    col.addEventListener('click', (e) => {
      if (e.target.closest('.tg-event')) return;
      const rect = col.getBoundingClientRect();
      const mins = ((e.clientY - rect.top) / HOUR_PX) * 60;
      const snapped = Math.floor(mins / 30) * 30;
      const when = new Date(d);
      when.setMinutes(snapped);
      ctx.onSlotClick(when);
    });

    // free/busy-only people (no shared details): opaque busy blocks
    for (const person of (ctx.state.meetWith || []).filter((p) => !p.detailed)) {
      for (const block of busySegments(person.busy, d)) {
        const o = el('div', 'tg-busy');
        o.style.setProperty('--c', person.color);
        o.style.top = `${block.startMin * (HOUR_PX / 60)}px`;
        o.style.height = `${(block.endMin - block.startMin) * (HOUR_PX / 60)}px`;
        o.title = `${person.name || person.email} — busy`;
        o.textContent = person.name || person.email.split('@')[0];
        col.appendChild(o);
      }
    }

    // timed events for this day (own + overlay, packed side by side)
    const segs = daySegments(allEvents, d);
    layoutColumns(segs);
    for (const seg of segs) col.appendChild(eventBlock(seg, ctx));

    if (D.sameDay(d, today)) {
      const now = new Date();
      const line = el('div', 'tg-now');
      line.style.top = `${(now.getHours() * 60 + now.getMinutes()) * (HOUR_PX / 60)}px`;
      col.appendChild(line);
    }
    body.appendChild(col);
  }
  wrap.appendChild(body);
  root.appendChild(wrap);

  // scroll to ~7:30am (or now)
  const target = D.sameDay(days[0], today) || days.some((d) => D.sameDay(d, today))
    ? Math.max(0, (new Date().getHours() - 1.5) * HOUR_PX)
    : 7.5 * HOUR_PX;
  body.scrollTop = target;
}

function el(tag, cls) {
  const x = document.createElement(tag);
  if (cls) x.className = cls;
  return x;
}

function bucketAllDay(state, days, allEvents) {
  const byDay = new Map(days.map((d) => [D.dateKey(d), []]));
  const items = [
    ...allEvents.filter((e) => e.allDay),
    ...state.items.tasks.filter((t) => t.due),
  ];
  for (const item of D.sortDayItems(items)) {
    for (const key of D.itemDayKeys(item)) {
      if (byDay.has(key)) byDay.get(key).push(item);
    }
  }
  return byDay;
}

function alldayChip(item, ctx) {
  const c = document.createElement('button');
  c.className = 'chip allday';
  if (item.overlay) c.classList.add('overlay');
  if (item.kind === 'task') {
    c.classList.add('task');
    if (item.completed) c.classList.add('done');
    c.textContent = `${item.completed ? '☑' : '☐'} ${item.title}`;
  } else {
    c.style.setProperty('--c', item.color);
    c.style.color = textOn(item.color);
    c.textContent = item.summary;
  }
  c.onclick = () => ctx.onItemClick(item, c);
  return c;
}

// Timed segments of events that intersect day `d`, clamped to the day.
function daySegments(events, d) {
  const dayStart = D.startOfDay(d);
  const dayEnd = D.addDays(dayStart, 1);
  const segs = [];
  for (const ev of events) {
    if (ev.allDay) continue;
    const s = D.parseWhen(ev.start), e = D.parseWhen(ev.end);
    if (!s || !e || e <= dayStart || s >= dayEnd) continue;
    const cs = s < dayStart ? dayStart : s;
    const ce = e > dayEnd ? dayEnd : e;
    segs.push({
      item: ev,
      startMin: (cs - dayStart) / 60000,
      endMin: Math.max((ce - dayStart) / 60000, (cs - dayStart) / 60000 + 20),
    });
  }
  segs.sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
  return segs;
}

// Busy intervals of a "Meet with" person clipped to day `d`.
function busySegments(busy, d) {
  const dayStart = D.startOfDay(d);
  const dayEnd = D.addDays(dayStart, 1);
  const out = [];
  for (const b of busy || []) {
    const s = new Date(b.start), e = new Date(b.end);
    if (e <= dayStart || s >= dayEnd) continue;
    const cs = s < dayStart ? dayStart : s;
    const ce = e > dayEnd ? dayEnd : e;
    out.push({ startMin: (cs - dayStart) / 60000, endMin: (ce - dayStart) / 60000 });
  }
  return out;
}

// Greedy column packing within overlap clusters.
function layoutColumns(segs) {
  let cluster = [];
  let clusterEnd = -1;
  const flush = () => {
    const cols = [];
    for (const seg of cluster) {
      let placed = false;
      for (let i = 0; i < cols.length; i++) {
        if (cols[i] <= seg.startMin) { seg.col = i; cols[i] = seg.endMin; placed = true; break; }
      }
      if (!placed) { seg.col = cols.length; cols.push(seg.endMin); }
    }
    for (const seg of cluster) seg.cols = cols.length;
    cluster = [];
  };
  for (const seg of segs) {
    if (cluster.length && seg.startMin >= clusterEnd) flush();
    cluster.push(seg);
    clusterEnd = Math.max(clusterEnd, seg.endMin);
  }
  if (cluster.length) flush();
}

function eventBlock(seg, ctx) {
  const b = document.createElement('button');
  b.className = 'tg-event';
  const { item } = seg;
  b.style.setProperty('--c', item.color);
  if (item.overlay) b.classList.add('overlay');
  else b.style.color = textOn(item.color);
  const heightPx = (seg.endMin - seg.startMin) * (HOUR_PX / 60) - 2;
  b.style.top = `${seg.startMin * (HOUR_PX / 60)}px`;
  b.style.height = `${heightPx}px`;
  const w = 100 / seg.cols;
  b.style.left = `calc(${seg.col * w}% + 1px)`;
  b.style.width = `calc(${w}% - 3px)`;
  // squeezed blocks drop the time line and clamp the title to one line
  if (heightPx < 38) b.classList.add('compact');
  if (seg.cols >= 3) b.classList.add('narrow');
  const s = D.parseWhen(item.start);
  const timeStr = `${D.fmtTime(s)} – ${D.fmtTime(D.parseWhen(item.end))}`;
  b.innerHTML = `<span class="tge-title"></span><span class="tge-time"></span>`;
  b.querySelector('.tge-title').textContent = item.summary;
  b.querySelector('.tge-time').textContent = timeStr;
  b.title = `${item.summary}\n${timeStr}${item.overlay ? `\n${item.calendarSummary}` : ''}`;
  const flag = priorityFlag(item);
  if (flag) b.querySelector('.tge-title').prepend(flag);
  b.onclick = (e) => { e.stopPropagation(); ctx.onItemClick(item, b); };
  return b;
}
