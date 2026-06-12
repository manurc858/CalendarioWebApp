import './env.js';
import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dbAll, dbGet, dbRun, initDb, usingPostgres } from './db.js';
import { getMeetingsInRange, getMeetingsForDate, refreshMeetings } from './outlook.js';
import { localIso, addDaysIso } from './dates.js';
// DESACTIVADO (no eliminar): agente IA conectado al modelo gemma (LM Studio)
// import { initAI, chatWithAI, saveDailySnapshot } from './ai.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught Exception:', err.message);
  console.error('[FATAL] Stack:', err.stack);
  if (err.cause) console.error('[FATAL] Cause:', err.cause);
});
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled Rejection:', reason);
});

const app = express();
app.use(cors());
app.use(express.json());

// Envuelve handlers async: cualquier error acaba en un 500 JSON, no en un crash
const ah = (fn) => (req, res) => {
  Promise.resolve(fn(req, res)).catch(err => {
    console.error(`[API] ${req.method} ${req.path}:`, err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  });
};

async function getExcludedMeetingSet({ date, from, to }) {
  let rows = [];
  if (date) {
    rows = await dbAll('SELECT uid, date FROM meeting_attendance WHERE attending=0 AND date=?', date);
  } else if (from && to) {
    rows = await dbAll('SELECT uid, date FROM meeting_attendance WHERE attending=0 AND date BETWEEN ? AND ?', from, to);
  }
  return new Set(rows.map(r => `${r.uid}|${r.date}`));
}

function normalizedMeetingTitle(title) {
  return String(title || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function dedupeMeetings(meetings = []) {
  const seen = new Set();
  return meetings.filter(m => {
    const key = [
      m.date || '',
      normalizedMeetingTitle(m.title),
      m.allDay ? '1' : '0',
      m.startTime || '',
      m.endTime || '',
    ].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// -------- Projects --------
app.get('/api/projects', ah(async (req, res) => {
  res.json(await dbAll('SELECT * FROM projects ORDER BY name'));
}));
app.post('/api/projects', ah(async (req, res) => {
  const { name, color, expected_hours, description, links } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const info = await dbRun('INSERT INTO projects(name, color, expected_hours, description, links) VALUES(?, ?, ?, ?, ?) RETURNING id',
    name, color || '#4f8cff', Number(expected_hours) || 0, description || '', links || '');
  res.json({ id: info.lastInsertRowid, name, color: color || '#4f8cff', expected_hours: Number(expected_hours) || 0, description: description || '', links: links || '' });
}));
app.put('/api/projects/:id', ah(async (req, res) => {
  const { name, color, expected_hours, description, links } = req.body;
  const current = await dbGet('SELECT * FROM projects WHERE id=?', Number(req.params.id));
  if (!current) return res.status(404).json({ error: 'not found' });
  await dbRun('UPDATE projects SET name=?, color=?, expected_hours=?, description=?, links=? WHERE id=?',
    name ?? current.name,
    color ?? current.color,
    expected_hours ?? current.expected_hours,
    description ?? current.description,
    links ?? current.links,
    Number(req.params.id)
  );
  res.json({ ok: true });
}));
app.delete('/api/projects/:id', ah(async (req, res) => {
  await dbRun('DELETE FROM projects WHERE id=?', Number(req.params.id));
  res.json({ ok: true });
}));

// Monthly expected hours per project
app.get('/api/projects/:id/month-hours', ah(async (req, res) => {
  res.json(await dbAll('SELECT month, hours FROM project_month_hours WHERE project_id=? ORDER BY month', Number(req.params.id)));
}));
app.put('/api/projects/:id/month-hours/:month', ah(async (req, res) => {
  const { hours } = req.body;
  const h = Number(hours) || 0;
  if (h <= 0) {
    await dbRun('DELETE FROM project_month_hours WHERE project_id=? AND month=?', Number(req.params.id), req.params.month);
  } else {
    await dbRun('INSERT INTO project_month_hours(project_id, month, hours) VALUES(?,?,?) ON CONFLICT(project_id, month) DO UPDATE SET hours=excluded.hours',
      Number(req.params.id), req.params.month, h);
  }
  res.json({ ok: true });
}));

// Totales de horas por proyecto
app.get('/api/projects/stats', ah(async (req, res) => {
  const { from, to } = req.query;
  let rows;
  if (from && to) {
    // Derive month key from 'from' date (e.g. '2026-04')
    const month = from.slice(0, 7);
    rows = await dbAll(`
      SELECT p.id, p.name, p.color, p.expected_hours,
             COALESCE(pmh.hours, p.expected_hours, 0) AS expected_hours_month,
             COALESCE(SUM(w.hours), 0) * 60 AS minutes
      FROM projects p
      LEFT JOIN work_entries w ON w.project_id = p.id AND w.date BETWEEN ? AND ?
      LEFT JOIN project_month_hours pmh ON pmh.project_id = p.id AND pmh.month = ?
      GROUP BY p.id, pmh.hours ORDER BY p.name
    `, from, to, month);

    // Add meeting minutes per project (Outlook + custom)
    try {
      const meetings = dedupeMeetings(await getMeetingsInRange(from, to));
      const excluded = await getExcludedMeetingSet({ from, to });
      const mpRows = await dbAll('SELECT mp.uid, mp.date, mp.project_id FROM meeting_projects mp WHERE mp.date BETWEEN ? AND ?', from, to);
      const mpMap = {};
      mpRows.forEach(r => { mpMap[`${r.uid}|${r.date}`] = r.project_id; });
      const meetingMinsByProject = {};
      meetings.forEach(m => {
        if (excluded.has(`${m.uid}|${m.date}`)) return;
        const pid = mpMap[`${m.uid}|${m.date}`];
        if (!pid || m.allDay || !m.startTime || !m.endTime) return;
        const [sh, sm] = m.startTime.split(':').map(Number);
        const [eh, em] = m.endTime.split(':').map(Number);
        const mins = (eh * 60 + em) - (sh * 60 + sm);
        if (mins > 0) meetingMinsByProject[pid] = (meetingMinsByProject[pid] || 0) + mins;
      });
      // Custom meetings (con recurrencias expandidas)
      const customMeetings = dedupeMeetings(
        (await listCustomMeetingsExpanded({ from, to })).map(cm => ({
          uid: `custom-${cm.id}`,
          date: cm.date,
          title: cm.title,
          allDay: !!cm.all_day,
          startTime: cm.start_time,
          endTime: cm.end_time,
        }))
      );
      customMeetings.forEach(cm => {
        if (excluded.has(`${cm.uid}|${cm.date}`)) return;
        const pid = mpMap[`${cm.uid}|${cm.date}`];
        if (!pid || cm.allDay || !cm.startTime || !cm.endTime) return;
        const [sh, sm] = cm.startTime.split(':').map(Number);
        const [eh, em] = cm.endTime.split(':').map(Number);
        const mins = (eh * 60 + em) - (sh * 60 + sm);
        if (mins > 0) meetingMinsByProject[pid] = (meetingMinsByProject[pid] || 0) + mins;
      });
      rows = rows.map(r => ({
        ...r,
        meeting_minutes: meetingMinsByProject[r.id] || 0,
      }));
    } catch (_) {
      rows = rows.map(r => ({ ...r, meeting_minutes: 0 }));
    }
  } else {
    rows = await dbAll(`
      SELECT p.id, p.name, p.color, p.expected_hours,
             p.expected_hours AS expected_hours_month,
             COALESCE(SUM(w.hours), 0) * 60 AS minutes
      FROM projects p
      LEFT JOIN work_entries w ON w.project_id = p.id
      GROUP BY p.id ORDER BY p.name
    `);
    rows = rows.map(r => ({ ...r, meeting_minutes: 0 }));
  }
  res.json(rows);
}));

// -------- Work entries --------
app.get('/api/work', ah(async (req, res) => {
  const { from, to, date } = req.query;
  let rows;
  if (date) {
    rows = await dbAll(`SELECT w.*, p.name AS project_name, p.color AS project_color
      FROM work_entries w LEFT JOIN projects p ON p.id = w.project_id
      WHERE w.date = ? ORDER BY w.start_time`, date);
  } else if (from && to) {
    rows = await dbAll(`SELECT w.*, p.name AS project_name, p.color AS project_color
      FROM work_entries w LEFT JOIN projects p ON p.id = w.project_id
      WHERE w.date BETWEEN ? AND ? ORDER BY w.date, w.start_time`, from, to);
  } else {
    rows = await dbAll(`SELECT w.*, p.name AS project_name, p.color AS project_color
      FROM work_entries w LEFT JOIN projects p ON p.id = w.project_id
      ORDER BY w.date, w.start_time`);
  }
  res.json(rows);
}));
app.post('/api/work', ah(async (req, res) => {
  const { date, hours, project_id, note } = req.body;
  const info = await dbRun(
    'INSERT INTO work_entries(date, start_time, end_time, hours, project_id, note) VALUES(?,?,?,?,?,?) RETURNING id',
    date, '', '', hours || 0, project_id || null, note || null);
  res.json({ id: info.lastInsertRowid });
}));
app.put('/api/work/:id', ah(async (req, res) => {
  const { hours, project_id, note } = req.body;
  await dbRun('UPDATE work_entries SET hours=?, project_id=?, note=? WHERE id=?',
    hours || 0, project_id || null, note || null, Number(req.params.id));
  res.json({ ok: true });
}));
app.delete('/api/work/:id', ah(async (req, res) => {
  await dbRun('DELETE FROM work_entries WHERE id=?', Number(req.params.id));
  res.json({ ok: true });
}));

// -------- Todos --------
app.get('/api/todos', ah(async (req, res) => {
  const { date, from, to } = req.query;
  let rows;
  if (date) rows = await dbAll('SELECT * FROM todos WHERE date=? ORDER BY sort_order, id', date);
  else if (from && to) rows = await dbAll('SELECT * FROM todos WHERE date BETWEEN ? AND ? ORDER BY date, sort_order, id', from, to);
  else rows = await dbAll("SELECT * FROM todos ORDER BY COALESCE(date, ''), sort_order, id");
  res.json(rows);
}));
app.post('/api/todos', ah(async (req, res) => {
  const { date, text } = req.body;
  const nextOrder = (await dbGet('SELECT COALESCE(MAX(sort_order), 0) + 1 AS value FROM todos WHERE date IS NOT DISTINCT FROM ?', date ?? null)).value;
  const info = await dbRun('INSERT INTO todos(date, text, done, sort_order) VALUES(?,?,0,?) RETURNING id', date ?? null, text, nextOrder);
  res.json({ id: info.lastInsertRowid });
}));
app.put('/api/todos/reorder', ah(async (req, res) => {
  const { date = null, orderedIds } = req.body;
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    return res.status(400).json({ error: 'orderedIds required' });
  }

  const existing = (await dbAll('SELECT id FROM todos WHERE date IS NOT DISTINCT FROM ?', date)).map(row => row.id);
  const existingSet = new Set(existing);
  const normalized = orderedIds.map(Number);

  if (normalized.length !== existing.length || new Set(normalized).size !== existing.length) {
    return res.status(400).json({ error: 'orderedIds must include each todo exactly once' });
  }
  if (normalized.some(id => !existingSet.has(id))) {
    return res.status(400).json({ error: 'orderedIds must match todos in target date bucket' });
  }

  for (let index = 0; index < normalized.length; index++) {
    await dbRun('UPDATE todos SET sort_order=? WHERE id=?', index + 1, normalized[index]);
  }
  res.json({ ok: true });
}));
app.put('/api/todos/:id', ah(async (req, res) => {
  const { text, done } = req.body;
  const current = await dbGet('SELECT * FROM todos WHERE id=?', Number(req.params.id));
  if (!current) return res.status(404).json({ error: 'not found' });
  const newDate = 'date' in req.body ? req.body.date : current.date;
  const movedDate = newDate !== current.date;
  const nextOrder = movedDate
    ? (await dbGet('SELECT COALESCE(MAX(sort_order), 0) + 1 AS value FROM todos WHERE date IS NOT DISTINCT FROM ?', newDate ?? null)).value
    : current.sort_order;
  await dbRun('UPDATE todos SET text=?, done=?, date=?, sort_order=? WHERE id=?',
    text ?? current.text, done ?? current.done, newDate, nextOrder, Number(req.params.id));
  res.json({ ok: true });
}));
app.delete('/api/todos/:id', ah(async (req, res) => {
  await dbRun('DELETE FROM todos WHERE id=?', Number(req.params.id));
  res.json({ ok: true });
}));
// Carry-over: duplica una tarea al día siguiente (o a la fecha indicada)
app.post('/api/todos/:id/carry-over', ah(async (req, res) => {
  const current = await dbGet('SELECT * FROM todos WHERE id=?', Number(req.params.id));
  if (!current) return res.status(404).json({ error: 'not found' });
  let toDate = req.body?.to_date ?? null;
  if (!toDate && current.date) {
    toDate = addDaysIso(current.date, 1);
  }
  const nextOrder = (await dbGet('SELECT COALESCE(MAX(sort_order), 0) + 1 AS value FROM todos WHERE date IS NOT DISTINCT FROM ?', toDate ?? null)).value;
  const info = await dbRun('INSERT INTO todos(date, text, done, sort_order) VALUES(?,?,0,?) RETURNING id',
    toDate ?? null, current.text, nextOrder);
  res.json({ id: info.lastInsertRowid, date: toDate, text: current.text });
}));
// Unassigned todos: date IS NULL, not done
app.get('/api/todos/unassigned', ah(async (req, res) => {
  res.json(await dbAll('SELECT * FROM todos WHERE date IS NULL AND done=0 ORDER BY sort_order, id'));
}));
// Overdue todos: not done, date < today
app.get('/api/todos/overdue', ah(async (req, res) => {
  const { before } = req.query;
  if (!before) return res.status(400).json({ error: 'before required' });
  res.json(await dbAll('SELECT * FROM todos WHERE done=0 AND date IS NOT NULL AND date < ? ORDER BY date, sort_order, id', before));
}));

// -------- Events --------
app.get('/api/events', ah(async (req, res) => {
  const { from, to, date } = req.query;
  let rows;
  if (date) rows = await dbAll('SELECT * FROM events WHERE date=? ORDER BY id', date);
  else if (from && to) rows = await dbAll('SELECT * FROM events WHERE date BETWEEN ? AND ? ORDER BY date', from, to);
  else rows = await dbAll('SELECT * FROM events ORDER BY date');
  res.json(rows);
}));
app.post('/api/events', ah(async (req, res) => {
  const { date, title, kind } = req.body;
  const info = await dbRun('INSERT INTO events(date, title, kind) VALUES(?,?,?) RETURNING id', date, title, kind || 'event');
  res.json({ id: info.lastInsertRowid });
}));
app.put('/api/events/:id', ah(async (req, res) => {
  const { date, title, kind } = req.body;
  await dbRun('UPDATE events SET date=?, title=?, kind=? WHERE id=?', date, title, kind, Number(req.params.id));
  res.json({ ok: true });
}));
app.delete('/api/events/:id', ah(async (req, res) => {
  await dbRun('DELETE FROM events WHERE id=?', Number(req.params.id));
  res.json({ ok: true });
}));

// -------- Labor calendar --------
app.get('/api/labor', ah(async (req, res) => {
  const { from, to } = req.query;
  const rows = (from && to)
    ? await dbAll('SELECT * FROM labor_days WHERE date BETWEEN ? AND ? ORDER BY date', from, to)
    : await dbAll('SELECT * FROM labor_days ORDER BY date');
  res.json(rows);
}));
app.put('/api/labor/:date', ah(async (req, res) => {
  const { type, label } = req.body;
  await dbRun(`INSERT INTO labor_days(date, type, label) VALUES(?,?,?)
    ON CONFLICT(date) DO UPDATE SET type=excluded.type, label=excluded.label`,
    req.params.date, type, label || null);
  res.json({ ok: true });
}));
app.delete('/api/labor/:date', ah(async (req, res) => {
  await dbRun('DELETE FROM labor_days WHERE date=?', req.params.date);
  res.json({ ok: true });
}));

// -------- Settings (vacaciones totales) --------
app.get('/api/settings', ah(async (req, res) => {
  const rows = await dbAll('SELECT * FROM settings');
  const obj = {};
  rows.forEach(r => { obj[r.key] = r.value; });
  res.json(obj);
}));
app.put('/api/settings/:key', ah(async (req, res) => {
  const { value } = req.body;
  await dbRun(`INSERT INTO settings(key, value) VALUES(?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value`, req.params.key, String(value));
  res.json({ ok: true });
}));

// -------- Resumen del día (todo junto) --------
app.get('/api/day/:date', ah(async (req, res) => {
  const date = req.params.date;
  let meetings = [];
  const excluded = await getExcludedMeetingSet({ date });
  try { meetings = await getMeetingsForDate(date); } catch (_) { meetings = []; }
  meetings = dedupeMeetings(meetings).map(m => ({ ...m, attending: !excluded.has(`${m.uid}|${m.date}`) }));

  // Enrich meetings with project info
  const mpRows = await dbAll('SELECT mp.uid, mp.project_id, p.name AS project_name, p.color AS project_color FROM meeting_projects mp JOIN projects p ON p.id = mp.project_id WHERE mp.date=?', date);
  const mpMap = {};
  mpRows.forEach(r => { mpMap[r.uid] = r; });
  meetings = meetings.map(m => {
    const mp = mpMap[m.uid];
    return mp ? { ...m, project_id: mp.project_id, project_name: mp.project_name, project_color: mp.project_color } : m;
  });

  // Custom meetings (con recurrencias expandidas)
  const customMeetingsRaw = await listCustomMeetingsExpanded({ date });
  const customMeetings = customMeetingsRaw.map(cm => {
    const mp = mpMap[`custom-${cm.id}`];
    return {
      uid: `custom-${cm.id}`,
      title: cm.title,
      date: cm.date,
      startTime: cm.start_time,
      endTime: cm.end_time,
      allDay: !!cm.all_day,
      attending: !excluded.has(`custom-${cm.id}|${cm.date}`),
      isCustom: true,
      customId: cm.id,
      notes: cm.notes,
      links: cm.links,
      repeat: cm.repeat || 'none',
      isRecurringInstance: !!cm.is_recurring_instance,
      ...(mp ? { project_id: mp.project_id, project_name: mp.project_name, project_color: mp.project_color } : {}),
    };
  });
  const mergedMeetings = dedupeMeetings([...meetings, ...customMeetings]);

  res.json({
    work: await dbAll(`SELECT w.*, p.name AS project_name, p.color AS project_color
      FROM work_entries w LEFT JOIN projects p ON p.id = w.project_id
      WHERE w.date=? ORDER BY w.start_time`, date),
    todos: await dbAll('SELECT * FROM todos WHERE date=? ORDER BY sort_order, id', date),
    events: await dbAll('SELECT * FROM events WHERE date=? ORDER BY id', date),
    labor: (await dbGet('SELECT * FROM labor_days WHERE date=?', date)) || null,
    meetings: mergedMeetings,
  });
}));

// -------- Outlook Meetings --------
app.get('/api/meetings', ah(async (req, res) => {
  const { from, to, date } = req.query;
  try {
    let meetings;
    if (date) meetings = await getMeetingsForDate(date);
    else if (from && to) meetings = await getMeetingsInRange(from, to);
    else return res.status(400).json({ error: 'date or from/to required' });
    const excluded = await getExcludedMeetingSet({ date, from, to });
    meetings = dedupeMeetings(meetings).map(m => ({ ...m, attending: !excluded.has(`${m.uid}|${m.date}`) }));

    // Enrich meetings with project info
    const mpRows = await dbAll('SELECT mp.uid, mp.date, mp.project_id, p.name AS project_name, p.color AS project_color FROM meeting_projects mp JOIN projects p ON p.id = mp.project_id');
    const mpMap = {};
    mpRows.forEach(r => { mpMap[`${r.uid}|${r.date}`] = r; });
    meetings = meetings.map(m => {
      const mp = mpMap[`${m.uid}|${m.date}`];
      return mp ? { ...m, project_id: mp.project_id, project_name: mp.project_name, project_color: mp.project_color } : m;
    });

    // Merge custom meetings (con recurrencias expandidas)
    const customRows = await listCustomMeetingsExpanded({ date, from, to });
    const customMeetings = customRows.map(cm => {
      const mp = mpMap[`custom-${cm.id}|${cm.date}`];
      return {
        uid: `custom-${cm.id}`,
        title: cm.title,
        date: cm.date,
        startTime: cm.start_time,
        endTime: cm.end_time,
        allDay: !!cm.all_day,
        attending: !excluded.has(`custom-${cm.id}|${cm.date}`),
        isCustom: true,
        customId: cm.id,
        notes: cm.notes,
        links: cm.links,
        repeat: cm.repeat || 'none',
        isRecurringInstance: !!cm.is_recurring_instance,
        ...(mp ? { project_id: mp.project_id, project_name: mp.project_name, project_color: mp.project_color } : {}),
      };
    });

    res.json(dedupeMeetings([...meetings, ...customMeetings]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}));
app.post('/api/meetings/refresh', ah(async (req, res) => {
  try {
    await refreshMeetings(true);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}));

// -------- Meeting → Project assignment --------
app.put('/api/meeting-project', ah(async (req, res) => {
  const { uid, date, project_id } = req.body;
  if (!uid || !date) return res.status(400).json({ error: 'uid and date required' });
  if (!project_id) {
    await dbRun('DELETE FROM meeting_projects WHERE uid=? AND date=?', uid, date);
  } else {
    await dbRun('INSERT INTO meeting_projects(uid, date, project_id) VALUES(?,?,?) ON CONFLICT(uid, date) DO UPDATE SET project_id=excluded.project_id',
      uid, date, project_id);
  }
  res.json({ ok: true });
}));

// -------- Meeting attendance --------
app.put('/api/meeting-attendance', ah(async (req, res) => {
  const { uid, date, attending } = req.body;
  if (!uid || !date) return res.status(400).json({ error: 'uid and date required' });

  if (attending === false || attending === 0) {
    await dbRun('INSERT INTO meeting_attendance(uid, date, attending) VALUES(?,?,0) ON CONFLICT(uid, date) DO UPDATE SET attending=0', uid, date);
  } else {
    await dbRun('DELETE FROM meeting_attendance WHERE uid=? AND date=?', uid, date);
  }
  res.json({ ok: true });
}));

// Expande reuniones recurrentes semanales en instancias dentro del rango.
// Cada instancia comparte uid (custom-<id>) pero con su propia fecha, así que
// asistencia, proyecto y notas por instancia funcionan sin cambios (clave uid+date).
async function listCustomMeetingsExpanded({ date, from, to } = {}) {
  const rangeFrom = date || from;
  const rangeTo = date || to;
  if (!rangeFrom || !rangeTo) {
    return await dbAll('SELECT * FROM custom_meetings ORDER BY date, start_time, id');
  }
  const rows = await dbAll(`
    SELECT * FROM custom_meetings
    WHERE (COALESCE(repeat, 'none') = 'none' AND date BETWEEN ? AND ?)
       OR (repeat = 'weekly' AND date <= ? AND (repeat_until IS NULL OR repeat_until >= ?))
  `, rangeFrom, rangeTo, rangeTo, rangeFrom);

  const out = [];
  for (const cm of rows) {
    if (cm.repeat !== 'weekly') { out.push(cm); continue; }
    // Primera instancia dentro del rango, alineada en saltos de 7 días desde la fecha base
    const base = new Date(cm.date + 'T00:00:00');
    const startRange = new Date(rangeFrom + 'T00:00:00');
    const diffDays = Math.round((startRange - base) / 86400000);
    const offset = diffDays > 0 ? Math.ceil(diffDays / 7) * 7 : 0;
    let cur = addDaysIso(cm.date, offset);
    const until = cm.repeat_until && cm.repeat_until < rangeTo ? cm.repeat_until : rangeTo;
    while (cur <= until) {
      out.push({ ...cm, date: cur, is_recurring_instance: cur === cm.date ? 0 : 1 });
      cur = addDaysIso(cur, 7);
    }
  }
  out.sort((a, b) =>
    a.date.localeCompare(b.date)
    || String(a.start_time || '').localeCompare(String(b.start_time || ''))
    || a.id - b.id
  );
  return out;
}

// -------- Custom Meetings (user-created) --------
app.get('/api/custom-meetings', ah(async (req, res) => {
  const { date, from, to } = req.query;
  res.json(await listCustomMeetingsExpanded({ date, from, to }));
}));
app.post('/api/custom-meetings', ah(async (req, res) => {
  const { date, title, start_time, end_time, all_day, notes, links, repeat, repeat_until } = req.body;
  if (!date || !title) return res.status(400).json({ error: 'date and title required' });
  const repeatVal = repeat === 'weekly' ? 'weekly' : 'none';
  const info = await dbRun(
    'INSERT INTO custom_meetings(date, title, start_time, end_time, all_day, notes, links, repeat, repeat_until) VALUES(?,?,?,?,?,?,?,?,?) RETURNING id',
    date, title, start_time || null, end_time || null, all_day ? 1 : 0, notes || '', links || '', repeatVal, repeatVal === 'weekly' ? (repeat_until || null) : null);
  res.json({ id: info.lastInsertRowid, date, title, start_time: start_time || null, end_time: end_time || null, all_day: all_day ? 1 : 0, notes: notes || '', links: links || '', repeat: repeatVal, repeat_until: repeatVal === 'weekly' ? (repeat_until || null) : null });
}));
app.put('/api/custom-meetings/:id', ah(async (req, res) => {
  const { date, title, start_time, end_time, all_day, notes, links, repeat, repeat_until } = req.body;
  const current = await dbGet('SELECT * FROM custom_meetings WHERE id=?', Number(req.params.id));
  if (!current) return res.status(404).json({ error: 'not found' });
  await dbRun('UPDATE custom_meetings SET date=?, title=?, start_time=?, end_time=?, all_day=?, notes=?, links=?, repeat=?, repeat_until=? WHERE id=?',
    date ?? current.date,
    title ?? current.title,
    start_time !== undefined ? start_time : current.start_time,
    end_time !== undefined ? end_time : current.end_time,
    all_day !== undefined ? (all_day ? 1 : 0) : current.all_day,
    notes !== undefined ? notes : current.notes,
    links !== undefined ? links : current.links,
    repeat !== undefined ? (repeat === 'weekly' ? 'weekly' : 'none') : (current.repeat || 'none'),
    repeat_until !== undefined ? (repeat_until || null) : current.repeat_until,
    Number(req.params.id)
  );
  res.json({ ok: true });
}));
app.delete('/api/custom-meetings/:id', ah(async (req, res) => {
  await dbRun('DELETE FROM custom_meetings WHERE id=?', Number(req.params.id));
  // Also delete associated notes
  await dbRun("DELETE FROM meeting_notes WHERE meeting_type='custom' AND meeting_ref=?", String(req.params.id));
  await dbRun('DELETE FROM meeting_attendance WHERE uid=?', `custom-${req.params.id}`);
  res.json({ ok: true });
}));

// -------- Meeting Notes --------
app.get('/api/meeting-notes', ah(async (req, res) => {
  const { meeting_type, meeting_ref, meeting_date } = req.query;
  if (!meeting_type || !meeting_ref || !meeting_date) return res.status(400).json({ error: 'meeting_type, meeting_ref, meeting_date required' });
  const row = await dbGet('SELECT * FROM meeting_notes WHERE meeting_type=? AND meeting_ref=? AND meeting_date=?', meeting_type, meeting_ref, meeting_date);
  res.json(row || { notes: '', links: '' });
}));
app.put('/api/meeting-notes', ah(async (req, res) => {
  const { meeting_type, meeting_ref, meeting_date, notes, links } = req.body;
  if (!meeting_type || !meeting_ref || !meeting_date) return res.status(400).json({ error: 'meeting_type, meeting_ref, meeting_date required' });
  await dbRun(`INSERT INTO meeting_notes(meeting_type, meeting_ref, meeting_date, notes, links) VALUES(?,?,?,?,?)
    ON CONFLICT(meeting_type, meeting_ref, meeting_date) DO UPDATE SET notes=excluded.notes, links=excluded.links`,
    meeting_type, meeting_ref, meeting_date, notes || '', links || '');
  res.json({ ok: true });
}));

// -------- AI Chat (AGENTE IA gemma DESACTIVADO - no eliminar) --------
// Nota: ai.js sigue usando la API síncrona de better-sqlite3; si se reactiva
// el agente habrá que adaptarlo al adaptador dbAll/dbGet/dbRun de db.js.
/* DESACTIVADO: rutas del agente conectado al modelo gemma
app.get('/api/ai/conversations', (req, res) => {
  const rows = db.prepare('SELECT * FROM chat_conversations ORDER BY updated_at DESC').all();
  res.json(rows);
});

app.post('/api/ai/conversations', (req, res) => {
  const title = req.body.title || 'Nueva conversación';
  const info = db.prepare('INSERT INTO chat_conversations(title) VALUES(?)').run(title);
  res.json({ id: info.lastInsertRowid, title, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
});

app.delete('/api/ai/conversations/:id', (req, res) => {
  db.prepare('DELETE FROM chat_messages WHERE conversation_id=?').run(req.params.id);
  db.prepare('DELETE FROM chat_conversations WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

app.put('/api/ai/conversations/:id', (req, res) => {
  const { title } = req.body;
  db.prepare(`UPDATE chat_conversations SET title=?, updated_at=datetime('now') WHERE id=?`).run(title, req.params.id);
  res.json({ ok: true });
});

app.get('/api/ai/conversations/:id/messages', (req, res) => {
  const rows = db.prepare('SELECT * FROM chat_messages WHERE conversation_id=? ORDER BY id').all(req.params.id);
  res.json(rows);
});

app.post('/api/ai/chat', async (req, res) => {
  console.log('[AI] Petición recibida:', req.body?.message?.slice(0, 50));
  try {
    const { message } = req.body;
    if (!message?.trim()) return res.status(400).json({ error: 'message required' });

    const reply = await chatWithAI(null, message);
    res.json({ reply });
  } catch (err) {
    console.error('[AI] Error en /api/ai/chat:', err.message);
    if (err.cause) console.error('[AI] Causa:', err.cause);
    res.status(502).json({ error: `Error: ${err.message}` });
  }
});

app.post('/api/ai/snapshot', async (req, res) => {
  try {
    const today = localIso();
    await saveDailySnapshot(today);
    res.json({ ok: true, date: today });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
*/

// Iniciar agente AI (DESACTIVADO - no eliminar)
// initAI();

// -------- Cliente estático (build de producción) --------
// Si existe client/dist (p. ej. en Render), el servidor sirve la app entera:
// una sola URL para API + interfaz, accesible desde el móvil.
const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) {
      return res.sendFile(path.join(clientDist, 'index.html'));
    }
    next();
  });
  console.log('[static] Sirviendo cliente desde client/dist');
}

// -------- Copia diaria de reuniones Outlook a las 20:00 --------
async function cacheOutlookMeetings() {
  const today = localIso();
  // Copiar reuniones de hoy + próximos 30 días
  const untilIso = addDaysIso(today, 30);
  try {
    const meetings = await getMeetingsInRange(today, untilIso);
    for (const m of meetings) {
      await dbRun(`
        INSERT INTO outlook_meetings_cache(uid, date, title, start_time, end_time, all_day, teams_url)
        VALUES(?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(uid, date) DO UPDATE SET
          title=excluded.title, start_time=excluded.start_time,
          end_time=excluded.end_time, all_day=excluded.all_day,
          teams_url=excluded.teams_url
      `, m.uid, m.date, m.title, m.startTime, m.endTime, m.allDay ? 1 : 0, m.teamsUrl || null);
    }
    console.log(`[cache] ${meetings.length} reuniones de Outlook guardadas (${today} → ${untilIso})`);
  } catch (err) {
    console.error('[cache] Error copiando reuniones Outlook:', err.message);
  }
}

function scheduleDailyCache() {
  const now = new Date();
  const target = new Date(now);
  target.setHours(20, 0, 0, 0);
  if (now >= target) target.setDate(target.getDate() + 1);
  const ms = target - now;
  console.log(`[cache] Próxima copia de reuniones programada para ${target.toLocaleString()}`);
  setTimeout(() => {
    cacheOutlookMeetings();
    // Repetir cada 24h
    setInterval(cacheOutlookMeetings, 24 * 60 * 60 * 1000);
  }, ms);
}

const PORT = process.env.PORT || 4000;
initDb()
  .then(() => {
    scheduleDailyCache();
    app.listen(PORT, () => console.log(`API listening on http://localhost:${PORT}`));
  })
  .catch(err => {
    console.error('[db] Error inicializando la base de datos:', err.message);
    process.exit(1);
  });
