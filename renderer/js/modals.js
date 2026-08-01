import { api } from './api.js';
import * as D from './dates.js';
import { state, loadItems } from './app.js';
import { toast } from './toast.js';
import { suggestionEmails, wireLocationSuggest, mapsUrl } from './suggest.js';
import { choiceDialog, confirmDialog } from './dialogs.js';
import { PRIORITIES, priorityOf } from './priority.js';

function dialog(cls) {
  const root = document.getElementById('modal-root');
  root.innerHTML = '';
  const dlg = document.createElement('dialog');
  dlg.className = cls;
  root.appendChild(dlg);
  dlg.addEventListener('close', () => setTimeout(() => dlg.remove(), 150));
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  return dlg;
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s ?? '';
  return d.innerHTML;
}

const writableCalendars = () =>
  state.calendars.filter((c) => ['owner', 'writer'].includes(c.accessRole));

function calendarOptions(selectedKey) {
  const groups = new Map();
  for (const c of writableCalendars()) {
    if (!groups.has(c.accountEmail)) groups.set(c.accountEmail, []);
    groups.get(c.accountEmail).push(c);
  }
  let html = '';
  for (const [email, cals] of groups) {
    html += `<optgroup label="${esc(email)}">`;
    for (const c of cals) {
      const key = `${email}::${c.id}`;
      html += `<option value="${esc(key)}" ${key === selectedKey ? 'selected' : ''}>${esc(c.summary)}</option>`;
    }
    html += '</optgroup>';
  }
  return html;
}

function taskListOptions(selectedKey) {
  let html = '';
  for (const l of state.taskLists) {
    const key = `${l.accountEmail}::${l.id}`;
    html += `<option value="${esc(key)}" ${key === selectedKey ? 'selected' : ''}>${esc(l.title)} — ${esc(l.accountEmail)}</option>`;
  }
  return html;
}

// ---------- Create / edit ----------
export function openEditor(opts = {}) {
  const editing = opts.item || null;
  const isTaskInit = editing ? editing.kind === 'task' : false;

  if (!writableCalendars().length && !state.taskLists.length) {
    toast('Sign in to a Google account first (Settings).', 'error');
    return;
  }

  let start = opts.start ? new Date(opts.start) : new Date();
  if (!opts.start) {
    start.setMinutes(Math.ceil(start.getMinutes() / 30) * 30, 0, 0);
  }
  let end = new Date(start.getTime() + 60 * 60000);
  let allDay = !!opts.allDay;

  if (editing && editing.kind === 'event') {
    start = D.parseWhen(editing.start);
    end = D.parseWhen(editing.end);
    allDay = editing.allDay;
    if (allDay) end = D.addDays(end, -1); // exclusive → inclusive for the form
  }
  const taskDue = editing?.kind === 'task' && editing.due ? D.parseWhen(editing.due)
    : opts.start ? new Date(opts.start) : new Date();

  const dlg = dialog('editor');
  const defaultCalKey = editing?.kind === 'event'
    ? `${editing.accountEmail}::${editing.calendarId}`
    : undefined;
  const defaultListKey = editing?.kind === 'task'
    ? `${editing.accountEmail}::${editing.tasklistId}`
    : undefined;

  dlg.innerHTML = `
    <form method="dialog" class="editor-form">
      <div class="editor-tabs" ${editing ? 'style="display:none"' : ''}>
        <button type="button" data-tab="event" class="${isTaskInit ? '' : 'active'}">Event</button>
        <button type="button" data-tab="task" class="${isTaskInit ? 'active' : ''}">Task</button>
      </div>
      <input name="title" class="title-input" placeholder="Add title" autocomplete="off" required
             value="${esc(editing ? (editing.summary ?? editing.title) : '')}" />

      <div class="tab-body" data-body="event" ${isTaskInit ? 'hidden' : ''}>
        <label class="row"><span>Calendar</span>
          <select name="calendar">${calendarOptions(defaultCalKey)}</select></label>
        <label class="row check"><input type="checkbox" name="allday" ${allDay ? 'checked' : ''}/><span>All day</span></label>
        <div class="row"><span>Guests</span>
          <div class="guest-box">
            <div class="guest-chips"></div>
            <input name="guest" placeholder="Type an email, press Enter" autocomplete="off" list="guest-suggest"/>
            <datalist id="guest-suggest"></datalist>
          </div></div>
        <label class="row check"><input type="checkbox" name="meet" ${editing?.hangoutLink ? 'checked disabled' : ''}/>
          <span>Add Google Meet video conferencing</span></label>
        <label class="row check guests-only" hidden><input type="checkbox" name="notify" checked/>
          <span>Email invitations to guests</span></label>
        <div class="row two">
          <label><span>Starts</span>
            <span class="dt"><input type="date" name="sdate" value="${D.toLocalInputDate(start)}" required/>
            <input type="time" name="stime" value="${D.toLocalInputTime(start)}" ${allDay ? 'hidden' : ''}/></span></label>
          <label><span>Ends</span>
            <span class="dt"><input type="date" name="edate" value="${D.toLocalInputDate(end)}" required/>
            <input type="time" name="etime" value="${D.toLocalInputTime(end)}" ${allDay ? 'hidden' : ''}/></span></label>
        </div>
        <label class="row"><span>Location</span>
          <input name="location" autocomplete="off" list="loc-suggest" placeholder="Search a place…" value="${esc(editing?.location || '')}"/>
          <datalist id="loc-suggest"></datalist></label>
        <div class="row"><span>Priority</span>
          <div class="prio-picker">
            ${[1, 2, 3, 4].map((p) => `
              <button type="button" data-prio="${p}" title="${PRIORITIES[p].label}" style="--pc:${PRIORITIES[p].color}">
                ⚑<span>${PRIORITIES[p].label}</span></button>`).join('')}
          </div></div>
        <label class="row"><span>Notes</span>
          <textarea name="description" rows="3">${esc(editing?.description || '')}</textarea></label>
      </div>

      <div class="tab-body" data-body="task" ${isTaskInit ? '' : 'hidden'}>
        <label class="row"><span>Task list</span>
          <select name="tasklist">${taskListOptions(defaultListKey)}</select></label>
        <div class="row two">
          <label><span>Due date</span>
            <span class="dt"><input type="date" name="due" value="${editing?.kind === 'task' && !editing.due ? '' : D.toLocalInputDate(taskDue)}"/></span></label>
        </div>
        <label class="row"><span>Notes</span>
          <textarea name="notes" rows="3">${esc(editing?.notes || '')}</textarea></label>
      </div>

      <div class="editor-actions">
        <button type="button" class="btn-ghost" data-act="cancel">Cancel</button>
        <button type="submit" class="btn-primary" data-act="save">${editing ? 'Save' : 'Create'}</button>
      </div>
    </form>`;

  let mode = isTaskInit ? 'task' : 'event';
  const form = dlg.querySelector('form');

  // --- guest chips ---
  const guests = [];
  const chipsEl = dlg.querySelector('.guest-chips');
  const guestInput = form.elements.guest;
  const notifyRow = dlg.querySelector('.guests-only');
  const renderGuests = () => {
    chipsEl.innerHTML = '';
    for (const g of guests) {
      const c = document.createElement('span');
      c.className = 'guest-chip';
      c.textContent = g;
      const x = document.createElement('button');
      x.type = 'button';
      x.textContent = '×';
      x.onclick = () => { guests.splice(guests.indexOf(g), 1); renderGuests(); };
      c.appendChild(x);
      chipsEl.appendChild(c);
    }
    notifyRow.hidden = !guests.length;
  };
  const addGuest = () => {
    const v = guestInput.value.trim().toLowerCase().replace(/,$/, '');
    if (!v) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { toast('Enter a valid email address.', 'error'); return; }
    if (!guests.includes(v)) guests.push(v);
    guestInput.value = '';
    renderGuests();
  };
  guestInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addGuest(); }
    else if (e.key === 'Backspace' && !guestInput.value && guests.length) { guests.pop(); renderGuests(); }
  });
  guestInput.addEventListener('blur', addGuest);
  // picking a datalist suggestion fires 'input' with a complete address
  guestInput.addEventListener('input', () => {
    if (guestInput.value.includes('@') && suggestionEmails().includes(guestInput.value)) addGuest();
  });
  const guestDl = dlg.querySelector('#guest-suggest');
  for (const email of suggestionEmails()) {
    const o = document.createElement('option');
    o.value = email;
    guestDl.appendChild(o);
  }

  // location autocomplete + priority picker
  wireLocationSuggest(form.elements.location, dlg.querySelector('#loc-suggest'));
  const calDefaultPrio = (key) => {
    const [em, id] = (key || '').split('::');
    return state.calendars.find((c) => c.accountEmail === em && c.id === id)?.priority || 1;
  };
  let priority = editing ? priorityOf(editing) : calDefaultPrio(form.elements.calendar.value);
  let prioTouched = false;
  const prioBtns = dlg.querySelectorAll('.prio-picker button');
  const paintPrio = () => prioBtns.forEach((b) =>
    b.classList.toggle('active', +b.dataset.prio === priority));
  prioBtns.forEach((b) => {
    b.onclick = () => { priority = +b.dataset.prio; prioTouched = true; paintPrio(); };
  });
  // new events follow the selected calendar's default until manually chosen
  form.elements.calendar.addEventListener('change', () => {
    if (!editing && !prioTouched) {
      priority = calDefaultPrio(form.elements.calendar.value);
      paintPrio();
    }
  });
  paintPrio();
  if (editing?.kind === 'event') {
    for (const a of editing.attendees || []) {
      if (!a.self && a.email) guests.push(a.email.toLowerCase());
    }
    renderGuests();
  }
  dlg.querySelectorAll('.editor-tabs button').forEach((b) => {
    b.onclick = () => {
      mode = b.dataset.tab;
      dlg.querySelectorAll('.editor-tabs button').forEach((x) => x.classList.toggle('active', x === b));
      dlg.querySelector('[data-body="event"]').hidden = mode !== 'event';
      dlg.querySelector('[data-body="task"]').hidden = mode !== 'task';
    };
  });
  form.elements.allday.onchange = () => {
    const hide = form.elements.allday.checked;
    form.elements.stime.hidden = hide;
    form.elements.etime.hidden = hide;
  };
  dlg.querySelector('[data-act="cancel"]').onclick = () => dlg.close();

  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = form.elements;
    try {
      if (mode === 'event') {
        const [accountEmail, calendarId] = f.calendar.value.split('::');
        if (!accountEmail) throw new Error('Pick a calendar.');
        const isAllDay = f.allday.checked;
        let resource;
        if (isAllDay) {
          const endD = D.parseWhen(f.edate.value);
          resource = {
            summary: f.title.value.trim(),
            location: f.location.value.trim() || undefined,
            description: f.description.value.trim() || undefined,
            start: { date: f.sdate.value },
            end: { date: D.dateKey(D.addDays(endD, 1)) }, // exclusive
          };
        } else {
          const s = new Date(`${f.sdate.value}T${f.stime.value || '00:00'}`);
          const en = new Date(`${f.edate.value}T${f.etime.value || '00:00'}`);
          if (en <= s) throw new Error('End must be after start.');
          resource = {
            summary: f.title.value.trim(),
            location: f.location.value.trim() || undefined,
            description: f.description.value.trim() || undefined,
            start: { dateTime: s.toISOString() },
            end: { dateTime: en.toISOString() },
          };
        }
        // guests: preserve original attendee objects (keeps their RSVPs)
        if (guests.length || editing?.attendees?.length) {
          const prev = new Map((editing?.attendees || []).map((a) => [a.email.toLowerCase(), a]));
          const attendees = guests.map((g) => {
            const old = prev.get(g);
            return old
              ? { email: old.email, displayName: old.displayName || undefined, optional: old.optional || undefined, responseStatus: old.responseStatus }
              : { email: g };
          });
          const self = (editing?.attendees || []).find((a) => a.self);
          if (self) attendees.push({ email: self.email, responseStatus: self.responseStatus });
          resource.attendees = attendees;
        }
        // write an explicit priority only when it differs from what the event
        // would inherit anyway (calendar default, or its current value)
        const inherited = editing ? priorityOf(editing) : calDefaultPrio(f.calendar.value);
        if (priority !== inherited) {
          resource.extendedProperties = { private: { luminaPriority: String(priority) } };
        }
        const opts = {};
        if (guests.length) opts.sendUpdates = f.notify.checked ? 'all' : 'none';
        if (f.meet.checked && !editing?.hangoutLink) {
          resource.conferenceData = {
            createRequest: {
              requestId: crypto.randomUUID(),
              conferenceSolutionKey: { type: 'hangoutsMeet' },
            },
          };
          opts.conferenceDataVersion = 1;
        }
        if (editing) {
          await api.updateEvent({
            accountEmail: editing.accountEmail,
            calendarId: editing.calendarId,
            eventId: editing.id,
            patch: resource,
            opts,
          });
          toast('Event updated');
        } else {
          await api.createEvent({ accountEmail, calendarId, resource, opts });
          toast('Event created');
        }
      } else {
        const [accountEmail, tasklistId] = (f.tasklist.value || '').split('::');
        if (!accountEmail) throw new Error('No task list available — sign in first.');
        const resource = {
          title: f.title.value.trim(),
          notes: f.notes.value.trim() || undefined,
          due: f.due.value ? new Date(`${f.due.value}T00:00:00Z`).toISOString() : undefined,
        };
        await api.createTask({ accountEmail, tasklistId, resource });
        toast('Task created');
      }
      dlg.close();
      loadItems(true);
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  dlg.showModal();
  dlg.querySelector('.title-input').focus();
}

// ---------- Details ----------
export function openDetails(item) {
  const dlg = dialog('details');
  const isTask = item.kind === 'task';
  const color = isTask ? 'var(--accent)' : item.color;

  let when;
  if (isTask) {
    when = item.due ? D.fmtDayLong(D.parseWhen(item.due)) : 'No due date';
  } else if (item.allDay) {
    const s = D.parseWhen(item.start);
    const e = D.addDays(D.parseWhen(item.end), -1);
    when = D.sameDay(s, e) ? D.fmtDayLong(s) : `${D.fmtDayShort(s)} – ${D.fmtDayShort(e)}`;
  } else {
    const s = D.parseWhen(item.start), e = D.parseWhen(item.end);
    when = `${D.fmtDayLong(s)} · ${D.fmtTime(s)} – ${D.fmtTime(e)}`;
  }

  const self = !isTask ? (item.attendees || []).find((a) => a.self) : null;
  const canEdit = isTask || item.canEdit !== false;

  const statusIcon = (s) =>
    s === 'accepted' ? '<span class="rsvp-ic yes">✓</span>'
    : s === 'declined' ? '<span class="rsvp-ic no">✕</span>'
    : s === 'tentative' ? '<span class="rsvp-ic maybe">~</span>'
    : '<span class="rsvp-ic pending">○</span>';

  let attendeesHtml = '';
  if (!isTask && item.attendees?.length) {
    const yes = item.attendees.filter((a) => a.responseStatus === 'accepted').length;
    const no = item.attendees.filter((a) => a.responseStatus === 'declined').length;
    const rows = item.attendees.map((a) => `
      <div class="att-row">${statusIcon(a.responseStatus)}
        <span class="att-name">${esc(a.displayName || a.email)}${a.organizer ? ' <em>(organizer)</em>' : ''}${a.self ? ' <em>(you)</em>' : ''}</span>
      </div>`).join('');
    attendeesHtml = `
      <details class="details-guests">
        <summary>👥 ${item.attendees.length} guest${item.attendees.length > 1 ? 's' : ''}
          <span class="muted">· ${yes} yes${no ? `, ${no} no` : ''}</span></summary>
        <div class="att-list">${rows}</div>
      </details>`;
  }

  dlg.innerHTML = `
    <div class="details-card">
      <div class="details-head">
        <span class="details-dot" style="--c:${color}"></span>
        <h2>${esc(isTask ? item.title : item.summary)}</h2>
      </div>
      <p class="details-when">${esc(when)}</p>
      ${!isTask && item.hangoutLink ? `
        <div class="details-meet">
          <button class="btn-meet" data-act="meet">🎥 Join with Google Meet</button>
          <button class="icon-btn" data-act="copy-meet" title="Copy link">⧉</button>
        </div>` : ''}
      ${item.location ? `<p class="details-meta">📍 <button class="linklike" data-act="map" title="Open in Google Maps">${esc(item.location)}</button></p>` : ''}
      ${!isTask && !item.overlay ? `
        <div class="details-prio">
          <span class="muted">Priority</span>
          ${[1, 2, 3, 4].map((p) => `
            <button data-setprio="${p}" title="${PRIORITIES[p].label}" style="--pc:${PRIORITIES[p].color}"
              class="${priorityOf(item) === p ? 'active' : ''}">⚑</button>`).join('')}
        </div>` : ''}
      ${attendeesHtml}
      ${(item.description || item.notes) ? `<p class="details-desc">${esc(item.description || item.notes)}</p>` : ''}
      ${!isTask && item.organizer && !item.attendees?.length ? `<p class="details-meta muted">Organizer: ${esc(item.organizer.name || item.organizer.email)}</p>` : ''}
      <p class="details-meta muted">${esc(isTask ? `${item.tasklistTitle} · ${item.accountEmail}` : `${item.calendarSummary} · ${item.accountEmail}`)}</p>
      ${self ? `
        <div class="rsvp-bar">
          <span>Going?</span>
          <button class="btn-ghost small ${self.responseStatus === 'accepted' ? 'rsvp-on' : ''}" data-rsvp="accepted">Yes</button>
          <button class="btn-ghost small ${self.responseStatus === 'declined' ? 'rsvp-on' : ''}" data-rsvp="declined">No</button>
          <button class="btn-ghost small ${self.responseStatus === 'tentative' ? 'rsvp-on' : ''}" data-rsvp="tentative">Maybe</button>
        </div>` : ''}
      <div class="editor-actions">
        ${isTask
          ? `<button class="btn-ghost" data-act="toggle">${item.completed ? 'Mark not done' : 'Mark done'}</button>`
          : (item.htmlLink ? '<button class="btn-ghost" data-act="open">Open in Google</button>' : '')}
        <div class="spacer"></div>
        ${item.overlay ? '<button class="btn-primary" data-act="copy-to-mine">＋ Add to my calendar</button>' : ''}
        ${canEdit ? '<button class="btn-ghost danger" data-act="delete">Delete</button>' : ''}
        ${!isTask && canEdit && !item.overlay ? '<button class="btn-primary" data-act="edit">Edit</button>' : ''}
      </div>
    </div>`;

  // copy someone else's event onto the account that can see their calendar
  dlg.querySelector('[data-act="copy-to-mine"]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const resource = {
        summary: item.summary,
        location: item.location || undefined,
        description: item.description || undefined,
        ...(item.allDay
          ? { start: { date: item.start }, end: { date: item.end } }
          : { start: { dateTime: new Date(item.start).toISOString() },
              end: { dateTime: new Date(item.end).toISOString() } }),
      };
      await api.createEvent({
        accountEmail: item.accountEmail,
        calendarId: 'primary',
        resource,
        opts: {},
      });
      toast(`Added to ${item.accountEmail}`);
      dlg.close();
      loadItems(true);
    } catch (err) {
      btn.disabled = false;
      toast(err.message, 'error');
    }
  });

  dlg.querySelector('[data-act="map"]')?.addEventListener('click', () => api.openExternal(mapsUrl(item.location)));

  // quick priority — for recurring events, ask which events to apply it to
  dlg.querySelectorAll('[data-setprio]').forEach((btn) => {
    btn.onclick = async () => {
      const p = +btn.dataset.setprio;
      if (p === priorityOf(item)) return;
      let targetId = item.id;
      if (item.recurringEventId) {
        const scope = await choiceDialog({
          title: 'Set priority for a repeating event',
          message: `Mark as ${PRIORITIES[p].label} (level ${p}):`,
          buttons: [
            { label: 'Just this event', value: 'single', kind: 'primary' },
            { label: 'All events in the series', value: 'all', kind: 'ghost' },
          ],
        });
        if (!scope) return;
        if (scope === 'all') targetId = item.recurringEventId;
      }
      try {
        // Google rejects custom data on locked event types (birthdays,
        // out-of-office, Gmail events) and read-only calendars — store
        // priority locally (this PC) for those.
        const locked = (item.eventType && item.eventType !== 'default') || item.canEdit === false;
        if (locked) {
          await api.setLocalPriority({
            accountEmail: item.accountEmail,
            calendarId: item.calendarId,
            eventId: targetId,
            priority: p,
          });
        } else {
          await api.updateEvent({
            accountEmail: item.accountEmail,
            calendarId: item.calendarId,
            eventId: targetId,
            patch: { extendedProperties: { private: { luminaPriority: String(p) } } },
          });
        }
        toast(`Priority: ${PRIORITIES[p].label}${locked ? ' (saved on this PC)' : ''}`);
        dlg.close();
        loadItems(true);
      } catch (e) { toast(e.message, 'error'); }
    };
  });

  dlg.querySelector('[data-act="meet"]')?.addEventListener('click', () => api.openExternal(item.hangoutLink));
  dlg.querySelector('[data-act="copy-meet"]')?.addEventListener('click', () => {
    navigator.clipboard.writeText(item.hangoutLink);
    toast('Meet link copied');
  });

  dlg.querySelectorAll('[data-rsvp]').forEach((btn) => {
    btn.onclick = async () => {
      const status = btn.dataset.rsvp;
      let targetId = item.id;
      if (item.recurringEventId) {
        const scope = await choiceDialog({
          title: 'RSVP to a repeating event',
          message: 'Send this response for:',
          buttons: [
            { label: 'Just this event', value: 'single', kind: 'primary' },
            { label: 'All events in the series', value: 'all', kind: 'ghost' },
          ],
        });
        if (!scope) return;
        if (scope === 'all') targetId = item.recurringEventId;
      }
      try {
        const attendees = item.attendees.map((a) => ({
          email: a.email,
          displayName: a.displayName || undefined,
          optional: a.optional || undefined,
          responseStatus: a.self ? status : a.responseStatus,
        }));
        await api.updateEvent({
          accountEmail: item.accountEmail,
          calendarId: item.calendarId,
          eventId: targetId,
          patch: { attendees },
        });
        toast(status === 'accepted' ? 'RSVP: Yes' : status === 'declined' ? 'RSVP: No' : 'RSVP: Maybe');
        dlg.close();
        loadItems(true);
      } catch (e) { toast(e.message, 'error'); }
    };
  });

  dlg.querySelector('[data-act="delete"]')?.addEventListener('click', async () => {
    const name = isTask ? item.title : item.summary;
    try {
      if (isTask) {
        if (!await confirmDialog({ title: `Delete "${name}"?`, message: 'The task is removed from Google Tasks.' })) return;
        await api.deleteTask({ accountEmail: item.accountEmail, tasklistId: item.tasklistId, taskId: item.id });
      } else if (item.recurringEventId) {
        const scope = await choiceDialog({
          title: `Delete repeating event "${name}"?`,
          message: 'This event repeats. Delete:',
          buttons: [
            { label: 'Just this event', value: 'single', kind: 'primary' },
            { label: 'This and following events', value: 'following', kind: 'ghost' },
            { label: 'All events in the series', value: 'all', kind: 'danger' },
          ],
        });
        if (!scope) return;
        await api.deleteEvent({
          accountEmail: item.accountEmail,
          calendarId: item.calendarId,
          eventId: item.id,
          scope,
          recurringEventId: item.recurringEventId,
          instanceStart: item.start,
          allDay: item.allDay,
        });
      } else {
        if (!await confirmDialog({ title: `Delete "${name}"?`, message: 'Guests are not notified.' })) return;
        await api.deleteEvent({ accountEmail: item.accountEmail, calendarId: item.calendarId, eventId: item.id });
      }
      toast('Deleted');
      dlg.close();
      loadItems(true);
    } catch (e) { toast(e.message, 'error'); }
  });
  dlg.querySelector('[data-act="edit"]')?.addEventListener('click', () => {
    dlg.close();
    openEditor({ item });
  });
  dlg.querySelector('[data-act="toggle"]')?.addEventListener('click', async () => {
    try {
      await api.setTaskCompleted({
        accountEmail: item.accountEmail, tasklistId: item.tasklistId,
        taskId: item.id, completed: !item.completed,
      });
      dlg.close();
      loadItems(true);
    } catch (e) { toast(e.message, 'error'); }
  });
  dlg.querySelector('[data-act="open"]')?.addEventListener('click', () => api.openExternal(item.htmlLink));

  dlg.showModal();
}
