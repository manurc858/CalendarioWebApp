const BASE = '/api';

async function req(path, opts = {}) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export const api = {
  // projects
  listProjects: () => req('/projects'),
  projectStats: (from, to) => req(`/projects/stats${from && to ? `?from=${from}&to=${to}` : ''}`),
  createProject: (data) => req('/projects', { method: 'POST', body: data }),
  updateProject: (id, data) => req(`/projects/${id}`, { method: 'PUT', body: data }),
  deleteProject: (id) => req(`/projects/${id}`, { method: 'DELETE' }),
  setMonthHours: (id, month, hours) => req(`/projects/${id}/month-hours/${month}`, { method: 'PUT', body: { hours } }),

  // work
  listWork: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return req('/work' + (q ? `?${q}` : ''));
  },
  createWork: (data) => req('/work', { method: 'POST', body: data }),
  updateWork: (id, data) => req(`/work/${id}`, { method: 'PUT', body: data }),
  deleteWork: (id) => req(`/work/${id}`, { method: 'DELETE' }),

  // todos
  listTodos: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return req('/todos' + (q ? `?${q}` : ''));
  },
  createTodo: (data) => req('/todos', { method: 'POST', body: data }),
  updateTodo: (id, data) => req(`/todos/${id}`, { method: 'PUT', body: data }),
  deleteTodo: (id) => req(`/todos/${id}`, { method: 'DELETE' }),
  overdueTodos: (before) => req(`/todos/overdue?before=${before}`),
  unassignedTodos: () => req('/todos/unassigned'),

  // events
  listEvents: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return req('/events' + (q ? `?${q}` : ''));
  },
  createEvent: (data) => req('/events', { method: 'POST', body: data }),
  updateEvent: (id, data) => req(`/events/${id}`, { method: 'PUT', body: data }),
  deleteEvent: (id) => req(`/events/${id}`, { method: 'DELETE' }),

  // labor
  listLabor: (from, to) => req(`/labor?from=${from}&to=${to}`),
  setLabor: (date, data) => req(`/labor/${date}`, { method: 'PUT', body: data }),
  clearLabor: (date) => req(`/labor/${date}`, { method: 'DELETE' }),

  // settings
  getSettings: () => req('/settings'),
  setSetting: (key, value) => req(`/settings/${key}`, { method: 'PUT', body: { value } }),

  // day
  getDay: (date) => req(`/day/${date}`),

  // meetings (Outlook ICS)
  listMeetings: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return req('/meetings' + (q ? `?${q}` : ''));
  },
  refreshMeetings: () => req('/meetings/refresh', { method: 'POST' }),
  setMeetingProject: (uid, date, project_id) =>
    req('/meeting-project', { method: 'PUT', body: { uid, date, project_id: project_id || null } }),

  // custom meetings (user-created)
  listCustomMeetings: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return req('/custom-meetings' + (q ? `?${q}` : ''));
  },
  createCustomMeeting: (data) => req('/custom-meetings', { method: 'POST', body: data }),
  updateCustomMeeting: (id, data) => req(`/custom-meetings/${id}`, { method: 'PUT', body: data }),
  deleteCustomMeeting: (id) => req(`/custom-meetings/${id}`, { method: 'DELETE' }),

  // meeting notes
  getMeetingNotes: (meeting_type, meeting_ref, meeting_date) =>
    req(`/meeting-notes?meeting_type=${meeting_type}&meeting_ref=${meeting_ref}&meeting_date=${meeting_date}`),
  saveMeetingNotes: (data) => req('/meeting-notes', { method: 'PUT', body: data }),
};
