import express from 'express';
import cors from 'cors';
import db from './db.js';
import { getMeetingsInRange, getMeetingsForDate, refreshMeetings } from './outlook.js';
import { initAI, chatWithAI, saveDailySnapshot } from './ai.js';

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

function getExcludedMeetingSet({ date, from, to }) {
  let rows = [];
  if (date) {
    rows = db.prepare('SELECT uid, date FROM meeting_attendance WHERE attending=0 AND date=?').all(date);
  } else if (from && to) {
    rows = db.prepare('SELECT uid, date FROM meeting_attendance WHERE attending=0 AND date BETWEEN ? AND ?').all(from, to);
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
app.get('/api/projects', (req, res) => {
  res.json(db.prepare('SELECT * FROM projects ORDER BY name').all());
});
app.post('/api/projects', (req, res) => {
  const { name, color, expected_hours, description, links } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const info = db.prepare('INSERT INTO projects(name, color, expected_hours, description, links) VALUES(?, ?, ?, ?, ?)')
    .run(name, color || '#4f8cff', Number(expected_hours) || 0, description || '', links || '');
  res.json({ id: info.lastInsertRowid, name, color: color || '#4f8cff', expected_hours: Number(expected_hours) || 0, description: description || '', links: links || '' });
});
app.put('/api/projects/:id', (req, res) => {
  const { name, color, expected_hours, description, links } = req.body;
  const current = db.prepare('SELECT * FROM projects WHERE id=?').get(req.params.id);
  if (!current) return res.status(404).json({ error: 'not found' });
  db.prepare('UPDATE projects SET name=?, color=?, expected_hours=?, description=?, links=? WHERE id=?').run(
    name ?? current.name,
    color ?? current.color,
    expected_hours ?? current.expected_hours,
    description ?? current.description,
    links ?? current.links,
    req.params.id
  );
  res.json({ ok: true });
});
app.delete('/api/projects/:id', (req, res) => {
  db.prepare('DELETE FROM projects WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// Monthly expected hours per project
app.get('/api/projects/:id/month-hours', (req, res) => {
  const rows = db.prepare('SELECT month, hours FROM project_month_hours WHERE project_id=? ORDER BY month').all(req.params.id);
  res.json(rows);
});
app.put('/api/projects/:id/month-hours/:month', (req, res) => {
  const { hours } = req.body;
  const h = Number(hours) || 0;
  if (h <= 0) {
    db.prepare('DELETE FROM project_month_hours WHERE project_id=? AND month=?').run(req.params.id, req.params.month);
  } else {
    db.prepare('INSERT INTO project_month_hours(project_id, month, hours) VALUES(?,?,?) ON CONFLICT(project_id, month) DO UPDATE SET hours=excluded.hours')
      .run(req.params.id, req.params.month, h);
  }
  res.json({ ok: true });
});

// Totales de horas por proyecto
app.get('/api/projects/stats', async (req, res) => {
  const { from, to } = req.query;
  let rows;
  if (from && to) {
    // Derive month key from 'from' date (e.g. '2026-04')
    const month = from.slice(0, 7);
    rows = db.prepare(`
      SELECT p.id, p.name, p.color, p.expected_hours,
             COALESCE(pmh.hours, p.expected_hours, 0) AS expected_hours_month,
             COALESCE(SUM(w.hours), 0) * 60 AS minutes
      FROM projects p
      LEFT JOIN work_entries w ON w.project_id = p.id AND w.date BETWEEN ? AND ?
      LEFT JOIN project_month_hours pmh ON pmh.project_id = p.id AND pmh.month = ?
      GROUP BY p.id ORDER BY p.name
    `).all(from, to, month);

    // Add meeting minutes per project (Outlook + custom)
    try {
      const meetings = dedupeMeetings(await getMeetingsInRange(from, to));
      const excluded = getExcludedMeetingSet({ from, to });
      const mpRows = db.prepare('SELECT mp.uid, mp.date, mp.project_id FROM meeting_projects mp WHERE mp.date BETWEEN ? AND ?').all(from, to);
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
      // Custom meetings
      const customMeetings = dedupeMeetings(
        db.prepare('SELECT * FROM custom_meetings WHERE date BETWEEN ? AND ?').all(from, to).map(cm => ({
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
    rows = db.prepare(`
      SELECT p.id, p.name, p.color, p.expected_hours,
             p.expected_hours AS expected_hours_month,
             COALESCE(SUM(w.hours), 0) * 60 AS minutes
      FROM projects p
      LEFT JOIN work_entries w ON w.project_id = p.id
      GROUP BY p.id ORDER BY p.name
    `).all();
    rows = rows.map(r => ({ ...r, meeting_minutes: 0 }));
  }
  res.json(rows);
});

// -------- Work entries --------
app.get('/api/work', (req, res) => {
  const { from, to, date } = req.query;
  let rows;
  if (date) {
    rows = db.prepare(`SELECT w.*, p.name AS project_name, p.color AS project_color
      FROM work_entries w LEFT JOIN projects p ON p.id = w.project_id
      WHERE w.date = ? ORDER BY w.start_time`).all(date);
  } else if (from && to) {
    rows = db.prepare(`SELECT w.*, p.name AS project_name, p.color AS project_color
      FROM work_entries w LEFT JOIN projects p ON p.id = w.project_id
      WHERE w.date BETWEEN ? AND ? ORDER BY w.date, w.start_time`).all(from, to);
  } else {
    rows = db.prepare(`SELECT w.*, p.name AS project_name, p.color AS project_color
      FROM work_entries w LEFT JOIN projects p ON p.id = w.project_id
      ORDER BY w.date, w.start_time`).all();
  }
  res.json(rows);
});
app.post('/api/work', (req, res) => {
  const { date, hours, project_id, note } = req.body;
  const info = db.prepare(
    'INSERT INTO work_entries(date, start_time, end_time, hours, project_id, note) VALUES(?,?,?,?,?,?)'
  ).run(date, '', '', hours || 0, project_id || null, note || null);
  res.json({ id: info.lastInsertRowid });
});
app.put('/api/work/:id', (req, res) => {
  const { hours, project_id, note } = req.body;
  db.prepare(
    'UPDATE work_entries SET hours=?, project_id=?, note=? WHERE id=?'
  ).run(hours || 0, project_id || null, note || null, req.params.id);
  res.json({ ok: true });
});
app.delete('/api/work/:id', (req, res) => {
  db.prepare('DELETE FROM work_entries WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// -------- Todos --------
app.get('/api/todos', (req, res) => {
  const { date, from, to } = req.query;
  let rows;
  if (date) rows = db.prepare('SELECT * FROM todos WHERE date=? ORDER BY sort_order, id').all(date);
  else if (from && to) rows = db.prepare('SELECT * FROM todos WHERE date BETWEEN ? AND ? ORDER BY date, sort_order, id').all(from, to);
  else rows = db.prepare("SELECT * FROM todos ORDER BY COALESCE(date, ''), sort_order, id").all();
  res.json(rows);
});
app.post('/api/todos', (req, res) => {
  const { date, text } = req.body;
  const nextOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS value FROM todos WHERE date IS ?').get(date ?? null).value;
  const info = db.prepare('INSERT INTO todos(date, text, done, sort_order) VALUES(?,?,0,?)').run(date ?? null, text, nextOrder);
  res.json({ id: info.lastInsertRowid });
});
app.put('/api/todos/reorder', (req, res) => {
  const { date = null, orderedIds } = req.body;
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    return res.status(400).json({ error: 'orderedIds required' });
  }

  const existing = db.prepare('SELECT id FROM todos WHERE date IS ?').all(date).map(row => row.id);
  const existingSet = new Set(existing);
  const normalized = orderedIds.map(Number);

  if (normalized.length !== existing.length || new Set(normalized).size !== existing.length) {
    return res.status(400).json({ error: 'orderedIds must include each todo exactly once' });
  }
  if (normalized.some(id => !existingSet.has(id))) {
    return res.status(400).json({ error: 'orderedIds must match todos in target date bucket' });
  }

  const update = db.prepare('UPDATE todos SET sort_order=? WHERE id=?');
  const tx = db.transaction(() => {
    normalized.forEach((id, index) => update.run(index + 1, id));
  });
  tx();
  res.json({ ok: true });
});
app.put('/api/todos/:id', (req, res) => {
  const { text, done } = req.body;
  const current = db.prepare('SELECT * FROM todos WHERE id=?').get(req.params.id);
  if (!current) return res.status(404).json({ error: 'not found' });
  const newDate = 'date' in req.body ? req.body.date : current.date;
  const movedDate = newDate !== current.date;
  const nextOrder = movedDate
    ? db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS value FROM todos WHERE date IS ?').get(newDate ?? null).value
    : current.sort_order;
  db.prepare('UPDATE todos SET text=?, done=?, date=?, sort_order=? WHERE id=?')
    .run(text ?? current.text, done ?? current.done, newDate, nextOrder, req.params.id);
  res.json({ ok: true });
});
app.delete('/api/todos/:id', (req, res) => {
  db.prepare('DELETE FROM todos WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});
// Carry-over: duplica una tarea al día siguiente (o a la fecha indicada)
app.post('/api/todos/:id/carry-over', (req, res) => {
  const current = db.prepare('SELECT * FROM todos WHERE id=?').get(req.params.id);
  if (!current) return res.status(404).json({ error: 'not found' });
  let toDate = req.body?.to_date ?? null;
  if (!toDate && current.date) {
    const d = new Date(current.date + 'T00:00:00');
    d.setDate(d.getDate() + 1);
    toDate = d.toISOString().slice(0, 10);
  }
  const nextOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS value FROM todos WHERE date IS ?').get(toDate ?? null).value;
  const info = db.prepare('INSERT INTO todos(date, text, done, sort_order) VALUES(?,?,0,?)')
    .run(toDate ?? null, current.text, nextOrder);
  res.json({ id: info.lastInsertRowid, date: toDate, text: current.text });
});
// Unassigned todos: date IS NULL, not done
app.get('/api/todos/unassigned', (req, res) => {
  const rows = db.prepare('SELECT * FROM todos WHERE date IS NULL AND done=0 ORDER BY sort_order, id').all();
  res.json(rows);
});
// Overdue todos: not done, date < today
app.get('/api/todos/overdue', (req, res) => {
  const { before } = req.query;
  if (!before) return res.status(400).json({ error: 'before required' });
  const rows = db.prepare('SELECT * FROM todos WHERE done=0 AND date IS NOT NULL AND date < ? ORDER BY date, sort_order, id').all(before);
  res.json(rows);
});

// -------- Events --------
app.get('/api/events', (req, res) => {
  const { from, to, date } = req.query;
  let rows;
  if (date) rows = db.prepare('SELECT * FROM events WHERE date=? ORDER BY id').all(date);
  else if (from && to) rows = db.prepare('SELECT * FROM events WHERE date BETWEEN ? AND ? ORDER BY date').all(from, to);
  else rows = db.prepare('SELECT * FROM events ORDER BY date').all();
  res.json(rows);
});
app.post('/api/events', (req, res) => {
  const { date, title, kind } = req.body;
  const info = db.prepare('INSERT INTO events(date, title, kind) VALUES(?,?,?)')
    .run(date, title, kind || 'event');
  res.json({ id: info.lastInsertRowid });
});
app.put('/api/events/:id', (req, res) => {
  const { date, title, kind } = req.body;
  db.prepare('UPDATE events SET date=?, title=?, kind=? WHERE id=?')
    .run(date, title, kind, req.params.id);
  res.json({ ok: true });
});
app.delete('/api/events/:id', (req, res) => {
  db.prepare('DELETE FROM events WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// -------- Labor calendar --------
app.get('/api/labor', (req, res) => {
  const { from, to } = req.query;
  const rows = (from && to)
    ? db.prepare('SELECT * FROM labor_days WHERE date BETWEEN ? AND ? ORDER BY date').all(from, to)
    : db.prepare('SELECT * FROM labor_days ORDER BY date').all();
  res.json(rows);
});
app.put('/api/labor/:date', (req, res) => {
  const { type, label } = req.body;
  db.prepare(`INSERT INTO labor_days(date, type, label) VALUES(?,?,?)
    ON CONFLICT(date) DO UPDATE SET type=excluded.type, label=excluded.label`)
    .run(req.params.date, type, label || null);
  res.json({ ok: true });
});
app.delete('/api/labor/:date', (req, res) => {
  db.prepare('DELETE FROM labor_days WHERE date=?').run(req.params.date);
  res.json({ ok: true });
});

// -------- Settings (vacaciones totales) --------
app.get('/api/settings', (req, res) => {
  const rows = db.prepare('SELECT * FROM settings').all();
  const obj = {};
  rows.forEach(r => { obj[r.key] = r.value; });
  res.json(obj);
});
app.put('/api/settings/:key', (req, res) => {
  const { value } = req.body;
  db.prepare(`INSERT INTO settings(key, value) VALUES(?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(req.params.key, String(value));
  res.json({ ok: true });
});

// -------- Resumen del día (todo junto) --------
app.get('/api/day/:date', async (req, res) => {
  const date = req.params.date;
  let meetings = [];
  const excluded = getExcludedMeetingSet({ date });
  try { meetings = await getMeetingsForDate(date); } catch (_) { meetings = []; }
  meetings = dedupeMeetings(meetings).map(m => ({ ...m, attending: !excluded.has(`${m.uid}|${m.date}`) }));

  // Enrich meetings with project info
  const mpRows = db.prepare('SELECT mp.uid, mp.project_id, p.name AS project_name, p.color AS project_color FROM meeting_projects mp JOIN projects p ON p.id = mp.project_id WHERE mp.date=?').all(date);
  const mpMap = {};
  mpRows.forEach(r => { mpMap[r.uid] = r; });
  meetings = meetings.map(m => {
    const mp = mpMap[m.uid];
    return mp ? { ...m, project_id: mp.project_id, project_name: mp.project_name, project_color: mp.project_color } : m;
  });

  // Custom meetings
  const customMeetingsRaw = db.prepare('SELECT * FROM custom_meetings WHERE date=? ORDER BY start_time, id').all(date);
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
      ...(mp ? { project_id: mp.project_id, project_name: mp.project_name, project_color: mp.project_color } : {}),
    };
  });
  const mergedMeetings = dedupeMeetings([...meetings, ...customMeetings]);

  res.json({
    work: db.prepare(`SELECT w.*, p.name AS project_name, p.color AS project_color
      FROM work_entries w LEFT JOIN projects p ON p.id = w.project_id
      WHERE w.date=? ORDER BY w.start_time`).all(date),
    todos: db.prepare('SELECT * FROM todos WHERE date=? ORDER BY sort_order, id').all(date),
    events: db.prepare('SELECT * FROM events WHERE date=? ORDER BY id').all(date),
    labor: db.prepare('SELECT * FROM labor_days WHERE date=?').get(date) || null,
    meetings: mergedMeetings,
  });
});

// -------- Outlook Meetings --------
app.get('/api/meetings', async (req, res) => {
  const { from, to, date } = req.query;
  try {
    let meetings;
    if (date) meetings = await getMeetingsForDate(date);
    else if (from && to) meetings = await getMeetingsInRange(from, to);
    else return res.status(400).json({ error: 'date or from/to required' });
    const excluded = getExcludedMeetingSet({ date, from, to });
    meetings = dedupeMeetings(meetings).map(m => ({ ...m, attending: !excluded.has(`${m.uid}|${m.date}`) }));

    // Enrich meetings with project info
    const mpRows = db.prepare('SELECT mp.uid, mp.date, mp.project_id, p.name AS project_name, p.color AS project_color FROM meeting_projects mp JOIN projects p ON p.id = mp.project_id').all();
    const mpMap = {};
    mpRows.forEach(r => { mpMap[`${r.uid}|${r.date}`] = r; });
    meetings = meetings.map(m => {
      const mp = mpMap[`${m.uid}|${m.date}`];
      return mp ? { ...m, project_id: mp.project_id, project_name: mp.project_name, project_color: mp.project_color } : m;
    });

    // Merge custom meetings
    let customRows;
    if (date) customRows = db.prepare('SELECT * FROM custom_meetings WHERE date=? ORDER BY start_time, id').all(date);
    else customRows = db.prepare('SELECT * FROM custom_meetings WHERE date BETWEEN ? AND ? ORDER BY date, start_time, id').all(from, to);
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
        ...(mp ? { project_id: mp.project_id, project_name: mp.project_name, project_color: mp.project_color } : {}),
      };
    });

    res.json(dedupeMeetings([...meetings, ...customMeetings]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.post('/api/meetings/refresh', async (req, res) => {
  try {
    await refreshMeetings(true);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------- Meeting → Project assignment --------
app.put('/api/meeting-project', (req, res) => {
  const { uid, date, project_id } = req.body;
  if (!uid || !date) return res.status(400).json({ error: 'uid and date required' });
  if (!project_id) {
    db.prepare('DELETE FROM meeting_projects WHERE uid=? AND date=?').run(uid, date);
  } else {
    db.prepare('INSERT INTO meeting_projects(uid, date, project_id) VALUES(?,?,?) ON CONFLICT(uid, date) DO UPDATE SET project_id=excluded.project_id')
      .run(uid, date, project_id);
  }
  res.json({ ok: true });
});

// -------- Meeting attendance --------
app.put('/api/meeting-attendance', (req, res) => {
  const { uid, date, attending } = req.body;
  if (!uid || !date) return res.status(400).json({ error: 'uid and date required' });

  if (attending === false || attending === 0) {
    db.prepare('INSERT INTO meeting_attendance(uid, date, attending) VALUES(?,?,0) ON CONFLICT(uid, date) DO UPDATE SET attending=0')
      .run(uid, date);
  } else {
    db.prepare('DELETE FROM meeting_attendance WHERE uid=? AND date=?').run(uid, date);
  }
  res.json({ ok: true });
});

// -------- Custom Meetings (user-created) --------
app.get('/api/custom-meetings', (req, res) => {
  const { date, from, to } = req.query;
  let rows;
  if (date) rows = db.prepare('SELECT * FROM custom_meetings WHERE date=? ORDER BY start_time, id').all(date);
  else if (from && to) rows = db.prepare('SELECT * FROM custom_meetings WHERE date BETWEEN ? AND ? ORDER BY date, start_time, id').all(from, to);
  else rows = db.prepare('SELECT * FROM custom_meetings ORDER BY date, start_time, id').all();
  res.json(rows);
});
app.post('/api/custom-meetings', (req, res) => {
  const { date, title, start_time, end_time, all_day, notes, links } = req.body;
  if (!date || !title) return res.status(400).json({ error: 'date and title required' });
  const info = db.prepare(
    'INSERT INTO custom_meetings(date, title, start_time, end_time, all_day, notes, links) VALUES(?,?,?,?,?,?,?)'
  ).run(date, title, start_time || null, end_time || null, all_day ? 1 : 0, notes || '', links || '');
  res.json({ id: info.lastInsertRowid, date, title, start_time: start_time || null, end_time: end_time || null, all_day: all_day ? 1 : 0, notes: notes || '', links: links || '' });
});
app.put('/api/custom-meetings/:id', (req, res) => {
  const { date, title, start_time, end_time, all_day, notes, links } = req.body;
  const current = db.prepare('SELECT * FROM custom_meetings WHERE id=?').get(req.params.id);
  if (!current) return res.status(404).json({ error: 'not found' });
  db.prepare('UPDATE custom_meetings SET date=?, title=?, start_time=?, end_time=?, all_day=?, notes=?, links=? WHERE id=?')
    .run(
      date ?? current.date,
      title ?? current.title,
      start_time !== undefined ? start_time : current.start_time,
      end_time !== undefined ? end_time : current.end_time,
      all_day !== undefined ? (all_day ? 1 : 0) : current.all_day,
      notes !== undefined ? notes : current.notes,
      links !== undefined ? links : current.links,
      req.params.id
    );
  res.json({ ok: true });
});
app.delete('/api/custom-meetings/:id', (req, res) => {
  db.prepare('DELETE FROM custom_meetings WHERE id=?').run(req.params.id);
  // Also delete associated notes
  db.prepare("DELETE FROM meeting_notes WHERE meeting_type='custom' AND meeting_ref=?").run(String(req.params.id));
  db.prepare('DELETE FROM meeting_attendance WHERE uid=?').run(`custom-${req.params.id}`);
  res.json({ ok: true });
});

// -------- Meeting Notes --------
app.get('/api/meeting-notes', (req, res) => {
  const { meeting_type, meeting_ref, meeting_date } = req.query;
  if (!meeting_type || !meeting_ref || !meeting_date) return res.status(400).json({ error: 'meeting_type, meeting_ref, meeting_date required' });
  const row = db.prepare('SELECT * FROM meeting_notes WHERE meeting_type=? AND meeting_ref=? AND meeting_date=?').get(meeting_type, meeting_ref, meeting_date);
  res.json(row || { notes: '', links: '' });
});
app.put('/api/meeting-notes', (req, res) => {
  const { meeting_type, meeting_ref, meeting_date, notes, links } = req.body;
  if (!meeting_type || !meeting_ref || !meeting_date) return res.status(400).json({ error: 'meeting_type, meeting_ref, meeting_date required' });
  db.prepare(`INSERT INTO meeting_notes(meeting_type, meeting_ref, meeting_date, notes, links) VALUES(?,?,?,?,?)
    ON CONFLICT(meeting_type, meeting_ref, meeting_date) DO UPDATE SET notes=excluded.notes, links=excluded.links`)
    .run(meeting_type, meeting_ref, meeting_date, notes || '', links || '');
  res.json({ ok: true });
});

// -------- AI Chat --------
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
    const today = new Date().toISOString().slice(0, 10);
    await saveDailySnapshot(today);
    res.json({ ok: true, date: today });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Iniciar agente AI
initAI();

// -------- Copia diaria de reuniones Outlook a las 20:00 --------
async function cacheOutlookMeetings() {
  const today = new Date().toISOString().slice(0, 10);
  // Copiar reuniones de hoy + próximos 30 días
  const until = new Date();
  until.setDate(until.getDate() + 30);
  const untilIso = until.toISOString().slice(0, 10);
  try {
    const meetings = await getMeetingsInRange(today, untilIso);
    const upsert = db.prepare(`
      INSERT INTO outlook_meetings_cache(uid, date, title, start_time, end_time, all_day, teams_url)
      VALUES(?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(uid, date) DO UPDATE SET
        title=excluded.title, start_time=excluded.start_time,
        end_time=excluded.end_time, all_day=excluded.all_day,
        teams_url=excluded.teams_url, cached_at=datetime('now')
    `);
    const tx = db.transaction(() => {
      for (const m of meetings) {
        upsert.run(m.uid, m.date, m.title, m.startTime, m.endTime, m.allDay ? 1 : 0, m.teamsUrl || null);
      }
    });
    tx();
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

scheduleDailyCache();

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`API listening on http://localhost:${PORT}`));
