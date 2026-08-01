// Thin wrapper over the preload bridge: unwraps {ok,data|error} responses.
async function call(name, ...args) {
  const res = await window.api[name](...args);
  if (!res || res.ok === undefined) return res;
  if (!res.ok) throw new Error(res.error || 'Unknown error');
  return res.data;
}

export const api = {
  getState: () => call('getState'),
  setCredentials: (c) => call('setCredentials', c),
  addAccount: () => call('addAccount'),
  removeAccount: (email) => call('removeAccount', email),
  listCalendars: (force) => call('listCalendars', force),
  setCalendarVisibility: (p) => call('setCalendarVisibility', p),
  setCalendarPriority: (p) => call('setCalendarPriority', p),
  getItems: (p) => call('getItems', p),
  createEvent: (p) => call('createEvent', p),
  updateEvent: (p) => call('updateEvent', p),
  deleteEvent: (p) => call('deleteEvent', p),
  getTaskLists: () => call('getTaskLists'),
  createTask: (p) => call('createTask', p),
  setTaskCompleted: (p) => call('setTaskCompleted', p),
  deleteTask: (p) => call('deleteTask', p),
  freeBusy: (p) => call('freeBusy', p),
  setLocalPriority: (p) => call('setLocalPriority', p),
  addContact: (p) => call('addContact', p),
  removeContact: (email) => call('removeContact', email),
  setWidgetEnabled: (b) => call('setWidgetEnabled', b),
  setLaunchAtStartup: (b) => call('setLaunchAtStartup', b),
  refreshNow: () => call('refreshNow'),
  openMain: () => call('openMain'),
  openExternal: (url) => call('openExternal', url),
  onDataChanged: (cb) => window.api.onDataChanged(cb),
};
