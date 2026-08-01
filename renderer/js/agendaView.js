import * as D from './dates.js';
import { priorityFlag } from './priority.js';

export function renderAgenda(root, ctx) {
  const { state } = ctx;
  const today = D.startOfDay(new Date());
  const wrap = document.createElement('div');
  wrap.className = 'agenda';

  const byDay = new Map();
  const dated = [...state.items.events, ...state.items.tasks.filter((t) => t.due)];
  for (const item of dated) {
    for (const key of D.itemDayKeys(item)) {
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(item);
    }
  }

  let any = false;
  for (let i = 0; i < 30; i++) {
    const date = D.addDays(today, i);
    const items = D.sortDayItems(byDay.get(D.dateKey(date)) || []);
    if (!items.length) continue;
    any = true;

    const day = document.createElement('div');
    day.className = 'agenda-day';
    const head = document.createElement('button');
    head.className = 'agenda-day-head';
    head.textContent = i === 0 ? `Today · ${D.fmtDayShort(date)}`
      : i === 1 ? `Tomorrow · ${D.fmtDayShort(date)}`
      : D.fmtDayLong(date);
    head.onclick = () => ctx.onDayClick(date);
    day.appendChild(head);
    for (const item of items) day.appendChild(row(item, ctx));
    wrap.appendChild(day);
  }

  const undated = state.items.tasks.filter((t) => !t.due && !t.completed);
  if (undated.length) {
    const day = document.createElement('div');
    day.className = 'agenda-day';
    const head = document.createElement('div');
    head.className = 'agenda-day-head';
    head.textContent = 'Tasks without a date';
    day.appendChild(head);
    for (const t of undated) day.appendChild(row(t, ctx));
    wrap.appendChild(day);
    any = true;
  }

  if (!any) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Nothing scheduled in the next 30 days.';
    wrap.appendChild(empty);
  }
  root.appendChild(wrap);
}

function row(item, ctx) {
  const r = document.createElement('button');
  r.className = 'agenda-row';
  if (item.kind === 'task') {
    r.classList.add('task');
    if (item.completed) r.classList.add('done');
    r.innerHTML = `<span class="a-check">${item.completed ? '☑' : '☐'}</span><span class="a-title"></span><span class="a-sub"></span>`;
    r.querySelector('.a-title').textContent = item.title;
    r.querySelector('.a-sub').textContent = item.tasklistTitle || 'Task';
  } else {
    r.style.setProperty('--c', item.color);
    const time = item.allDay
      ? 'All day'
      : `${D.fmtTime(D.parseWhen(item.start))} – ${D.fmtTime(D.parseWhen(item.end))}`;
    r.innerHTML = `<span class="a-dot"></span><span class="a-time"></span><span class="a-title"></span><span class="a-sub"></span>`;
    r.querySelector('.a-time').textContent = time;
    r.querySelector('.a-title').textContent = item.summary;
    r.querySelector('.a-sub').textContent = item.location || item.calendarSummary || '';
    const flag = priorityFlag(item);
    if (flag) r.querySelector('.a-title').prepend(flag);
  }
  r.onclick = () => ctx.onItemClick(item, r);
  return r;
}
