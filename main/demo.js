'use strict';
// Sample data for `npm start -- --demo` so the UI can be exercised
// without Google credentials.

const DEMO_CALS = [
  { accountEmail: 'demo@example.com', id: 'personal', summary: 'Personal', color: '#5b7cfa', primary: true, accessRole: 'owner', visible: true },
  { accountEmail: 'demo@example.com', id: 'work', summary: 'Work', color: '#e8735a', primary: false, accessRole: 'owner', visible: true },
  { accountEmail: 'demo@example.com', id: 'bday', summary: 'Birthdays', color: '#81d4fa', primary: false, accessRole: 'reader', visible: true },
  { accountEmail: 'second@example.com', id: 'fitness', summary: 'Fitness', color: '#4caf7d', primary: true, accessRole: 'owner', visible: true },
];

const dayISO = (d) => {
  const x = new Date();
  x.setDate(x.getDate() + d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
const at = (d, h, m = 0) => {
  const x = new Date();
  x.setDate(x.getDate() + d);
  x.setHours(h, m, 0, 0);
  return x.toISOString();
};

function calendars() { return DEMO_CALS; }

function accounts() {
  return [
    { email: 'demo@example.com', name: 'Demo Account' },
    { email: 'second@example.com', name: 'Second Account' },
  ];
}

function taskLists() {
  return [{ accountEmail: 'demo@example.com', id: 'list1', title: 'My Tasks' }];
}

function items() {
  const ev = (cal, id, summary, start, end, extra = {}) => ({
    kind: 'event', accountEmail: cal.accountEmail, calendarId: cal.id,
    calendarSummary: cal.summary, color: cal.color, id,
    canEdit: cal.accessRole !== 'reader',
    summary, description: extra.description || '', location: extra.location || '',
    allDay: !!extra.allDay, start, end, htmlLink: '',
    hangoutLink: extra.meet || '',
    organizer: extra.organizer || null,
    attendees: extra.attendees || [],
    priority: extra.priority || 1,
    recurringEventId: extra.recurring ? `${id}_master` : null,
  });
  const [p, w, b, f] = DEMO_CALS;
  const events = [
    ev(p, 'e1', 'Coffee with Maya', at(0, 9, 30), at(0, 10, 15), { location: 'Blue Tokai' }),
    ev(w, 'e2', 'Sprint planning', at(0, 11), at(0, 12), {
      meet: 'https://meet.google.com/abc-defg-hij',
      organizer: { email: 'lead@example.com', name: 'Team Lead' },
      attendees: [
        { email: 'demo@example.com', displayName: 'Demo Account', responseStatus: 'needsAction', self: true, organizer: false, optional: false },
        { email: 'lead@example.com', displayName: 'Team Lead', responseStatus: 'accepted', self: false, organizer: true, optional: false },
        { email: 'maya@example.com', displayName: 'Maya', responseStatus: 'accepted', self: false, organizer: false, optional: false },
        { email: 'sam@example.com', displayName: 'Sam', responseStatus: 'declined', self: false, organizer: false, optional: false },
      ],
    }),
    ev(w, 'e3', 'Design review', at(0, 14), at(0, 15, 30), { description: 'Review dashboard mockups' }),
    ev(b, 'e14', "Arjun's birthday 🎂", dayISO(1), dayISO(2), { allDay: true }),
    ev(f, 'e4', 'Gym — push day', at(0, 18), at(0, 19)),
    ev(p, 'e5', 'Dinner with family', at(1, 19, 30), at(1, 21), { priority: 2 }),
    ev(w, 'e6', 'Quarterly review', at(2, 10), at(2, 11, 30), { priority: 4, recurring: true }),
    ev(p, 'e7', "Ria's birthday", dayISO(3), dayISO(4), { allDay: true }),
    ev(w, 'e8', 'Offsite', dayISO(5), dayISO(7), { allDay: true, location: 'Goa' }),
    ev(f, 'e9', 'Morning run', at(1, 6, 30), at(1, 7, 15)),
    ev(w, 'e10', '1:1 with lead', at(-1, 15), at(-1, 15, 30)),
    ev(p, 'e11', 'Dentist', at(8, 9), at(8, 9, 45), { priority: 3 }),
    ev(w, 'e12', 'Team standup', at(0, 9, 0), at(0, 9, 15), { recurring: true }),
    ev(p, 'e13', 'Weekend trip planning', at(4, 17), at(4, 18)),
  ];
  const tasks = [
    { kind: 'task', accountEmail: 'demo@example.com', tasklistId: 'list1', tasklistTitle: 'My Tasks', id: 't1', title: 'Pay electricity bill', notes: '', due: dayISO(0), completed: false },
    { kind: 'task', accountEmail: 'demo@example.com', tasklistId: 'list1', tasklistTitle: 'My Tasks', id: 't2', title: 'Send project proposal', notes: 'Include budget section', due: dayISO(1), completed: false },
    { kind: 'task', accountEmail: 'demo@example.com', tasklistId: 'list1', tasklistTitle: 'My Tasks', id: 't3', title: 'Book flight tickets', notes: '', due: dayISO(4), completed: false },
    { kind: 'task', accountEmail: 'demo@example.com', tasklistId: 'list1', tasklistTitle: 'My Tasks', id: 't4', title: 'Renew gym membership', notes: '', due: null, completed: false },
    { kind: 'task', accountEmail: 'demo@example.com', tasklistId: 'list1', tasklistTitle: 'My Tasks', id: 't5', title: 'Submit expense report', notes: '', due: dayISO(-1), completed: true },
  ];
  return { events, tasks };
}

function meetWith(person, startISO, endISO) {
  const start = new Date(startISO);
  const days = Math.min(40, Math.round((new Date(endISO) - start) / 86400000) + 1);
  const mk = (d, h1, m1, h2, m2) => {
    const s = new Date(d); s.setHours(h1, m1, 0, 0);
    const e = new Date(d); e.setHours(h2, m2, 0, 0);
    return [s.toISOString(), e.toISOString()];
  };
  // person emails containing "busy" only expose free/busy — tests the fallback
  const detailed = !person.includes('busy');
  const events = [];
  const busy = [];
  const titles = [['Standup', 9, 15, 9, 30], ['Deep work', 10, 0, 11, 30], ['Client call', 14, 0, 15, 0], ['Design sync', 16, 30, 17, 15]];
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    for (const [title, h1, m1, h2, m2] of titles) {
      if ((i + title.length + person.length) % 3 === 0) continue; // vary per day/person
      const [s, e] = mk(d, h1, m1, h2, m2);
      if (detailed) {
        events.push({
          kind: 'event', overlay: true, canEdit: false,
          accountEmail: 'demo@example.com', calendarId: person,
          calendarSummary: `${person}'s calendar`, color: '#9aa0b4',
          id: `ov-${person}-${i}-${title}`, summary: title,
          description: '', location: title === 'Client call' ? 'Meet room 2' : '',
          allDay: false, start: s, end: e, htmlLink: '', hangoutLink: '',
          organizer: null, attendees: [], priority: 1, recurringEventId: null,
        });
      } else {
        busy.push({ start: s, end: e });
      }
    }
  }
  return { events, busy, viaAccount: 'demo@example.com', detailed };
}

module.exports = { calendars, accounts, taskLists, items, meetWith };
