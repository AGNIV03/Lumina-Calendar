import { api } from './api.js';
import * as D from './dates.js';
import { PRIORITIES, priorityOf, priorityFlag } from './priority.js';

async function load() {
  const start = D.startOfDay(new Date());
  const end = D.addDays(start, 32); // level-4 events surface a month early
  let items = { events: [], tasks: [] };
  try {
    items = await api.getItems({ start: start.toISOString(), end: end.toISOString() });
  } catch { /* not signed in yet */ }
  render(items);
}

function render(items) {
  const now = new Date();
  const today = D.startOfDay(now);
  document.getElementById('w-day').textContent =
    now.toLocaleDateString([], { weekday: 'long' });
  document.getElementById('w-date').textContent =
    now.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });

  const byDay = new Map();
  const dated = [...items.events, ...items.tasks.filter((t) => t.due)];
  for (const item of dated) {
    for (const key of D.itemDayKeys(item)) {
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(item);
    }
  }

  // Today
  const todayRoot = document.getElementById('w-today');
  todayRoot.innerHTML = '';
  const todayItems = D.sortDayItems(byDay.get(D.dateKey(today)) || []);
  if (!todayItems.length) {
    todayRoot.innerHTML = '<div class="w-empty">Nothing scheduled — enjoy! ✨</div>';
  }
  for (const item of todayItems) todayRoot.appendChild(row(item, now));

  // Upcoming — how far ahead an event appears depends on its priority:
  // L1 day-of only, L2 = 1 day, L3 = 1 week, L4 = 1 month. Tasks: 1 week.
  const upRoot = document.getElementById('w-upcoming');
  upRoot.innerHTML = '';
  let any = false;
  for (let i = 1; i <= 31; i++) {
    const d = D.addDays(today, i);
    const dayItems = D.sortDayItems(byDay.get(D.dateKey(d)) || [])
      .filter((it) => {
        if (it.kind === 'task') return !it.completed && i <= 7;
        return i <= PRIORITIES[priorityOf(it)].days;
      });
    if (!dayItems.length) continue;
    any = true;
    const lbl = document.createElement('div');
    lbl.className = 'w-daylabel';
    lbl.textContent = i === 1 ? 'Tomorrow'
      : d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
    upRoot.appendChild(lbl);
    for (const item of dayItems.slice(0, 4)) upRoot.appendChild(row(item, now));
  }
  if (!any) upRoot.innerHTML = '<div class="w-empty">Nothing coming up.</div>';
}

function row(item, now) {
  const r = document.createElement(item.kind === 'task' ? 'div' : 'button');
  r.className = 'w-row';
  if (item.kind === 'task') {
    if (item.completed) r.classList.add('done');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'w-check';
    cb.checked = item.completed;
    cb.onchange = async () => {
      try {
        await api.setTaskCompleted({
          accountEmail: item.accountEmail, tasklistId: item.tasklistId,
          taskId: item.id, completed: cb.checked,
        });
      } catch { cb.checked = !cb.checked; }
    };
    const main = document.createElement('div');
    main.className = 'w-main';
    main.innerHTML = '<span class="w-title"></span><span class="w-sub">Task</span>';
    main.querySelector('.w-title').textContent = item.title;
    r.append(cb, main);
  } else {
    const s = D.parseWhen(item.start);
    const e = D.parseWhen(item.end);
    if (!item.allDay && e < now) r.classList.add('past');
    const dot = document.createElement('span');
    dot.className = 'w-dot';
    dot.style.setProperty('--c', item.color);
    const main = document.createElement('div');
    main.className = 'w-main';
    main.innerHTML = '<span class="w-title"></span><span class="w-sub"></span>';
    main.querySelector('.w-title').textContent = item.summary;
    main.querySelector('.w-sub').textContent = item.allDay
      ? 'All day'
      : `${D.fmtTime(s)} – ${D.fmtTime(e)}${item.location ? ' · ' + item.location : ''}`;
    const flag = priorityFlag(item);
    if (flag) main.querySelector('.w-title').prepend(flag);
    r.append(dot, main);
    r.onclick = () => api.openMain();
  }
  return r;
}

document.getElementById('w-open').onclick = () => api.openMain();
api.onDataChanged(load);
load();
setInterval(load, 60 * 1000); // keep "past" fading and date fresh
