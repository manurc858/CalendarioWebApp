import http from 'node:http';
import db from './db.js';
import { getMeetingsInRange } from './outlook.js';
import { localIso, addDaysIso } from './dates.js';

const LM_STUDIO_URL = process.env.LM_STUDIO_URL || 'http://127.0.0.1:1234';
const LM_MODEL = process.env.LM_MODEL || 'google/gemma-4-e4b';
const FETCH_TIMEOUT = 600_000; // 10 minutos max para respuesta del modelo

// Wrapper HTTP nativo para evitar crash de native fetch en Node v24 + Express
function httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const postData = typeof body === 'string' ? body : JSON.stringify(body);
    const req = http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          reject(new Error(`Invalid JSON from LM Studio: ${data.slice(0, 200)}`));
        }
      });
    });
    req.setTimeout(FETCH_TIMEOUT, () => {
      req.destroy();
      reject(new Error('LM Studio timeout'));
    });
    req.on('error', (err) => reject(new Error(`LM Studio connection error: ${err.message}`)));
    req.write(postData);
    req.end();
  });
}

// -------- Contexto completo para el modelo --------

async function buildCompactContext(dateIso) {
  const ctx = { hoy: dateIso };

  // Proyectos con descripción y links
  try {
    const projects = db.prepare('SELECT name, expected_hours, description, links FROM projects ORDER BY name').all();
    ctx.proyectos = projects.map(p => {
      let s = `${p.name} (${p.expected_hours}h)`;
      if (p.description) s += ` - ${p.description}`;
      if (p.links) s += ` [links: ${p.links}]`;
      return s;
    });
  } catch (e) { console.error('[AI] Error proyectos:', e.message); ctx.proyectos = []; }

  // Tareas: hoy + próximos 7 días + vencidas + sin asignar
  try {
    const weekEndIso = addDaysIso(dateIso, 7);

    ctx.tareas_hoy = db.prepare('SELECT text, done FROM todos WHERE date = ? ORDER BY sort_order, id').all(dateIso)
      .map(t => `[${t.done ? 'HECHA' : 'PENDIENTE'}] ${t.text}`);

    ctx.tareas_proximos_dias = db.prepare('SELECT date, text, done FROM todos WHERE date > ? AND date <= ? ORDER BY date, sort_order, id').all(dateIso, weekEndIso)
      .map(t => `${t.date} [${t.done ? 'HECHA' : 'PENDIENTE'}] ${t.text}`);

    ctx.tareas_vencidas = db.prepare('SELECT text, date FROM todos WHERE done = 0 AND date IS NOT NULL AND date < ? ORDER BY date LIMIT 20').all(dateIso)
      .map(t => `${t.text} (vencía ${t.date})`);

    ctx.tareas_sin_asignar = db.prepare('SELECT text FROM todos WHERE date IS NULL AND done = 0 ORDER BY sort_order, id LIMIT 15').all()
      .map(t => t.text);
  } catch (e) { console.error('[AI] Error tareas:', e.message); }

  // Horas este mes por proyecto + trabajo reciente con notas
  try {
    const monthKey = dateIso.slice(0, 7);
    ctx.horas_mes_por_proyecto = db.prepare(`
      SELECT p.name, ROUND(COALESCE(SUM(w.hours), 0), 1) AS hours
      FROM projects p LEFT JOIN work_entries w ON w.project_id = p.id AND w.date LIKE ? || '%'
      GROUP BY p.id HAVING hours > 0 ORDER BY hours DESC
    `).all(monthKey).map(p => `${p.name}: ${p.hours}h`);

    ctx.trabajo_reciente = db.prepare(`
      SELECT w.date, ROUND(w.hours, 1) AS hours, p.name AS proyecto, w.note
      FROM work_entries w LEFT JOIN projects p ON p.id = w.project_id
      WHERE w.date >= date(?, '-7 days') AND w.date <= ?
      ORDER BY w.date DESC, w.id LIMIT 30
    `).all(dateIso, dateIso).map(w => {
      let s = `${w.date} ${w.proyecto || 'Sin proyecto'} ${w.hours}h`;
      if (w.note) s += ` (${w.note})`;
      return s;
    });
  } catch (e) { console.error('[AI] Error horas:', e.message); }

  // Reuniones: Outlook (ICS cache en memoria) + custom meetings
  try {
    const weekEndIso = addDaysIso(dateIso, 7);

    const outlookMeetings = await getMeetingsInRange(dateIso, weekEndIso);

    const excludedRows = db.prepare('SELECT uid, date FROM meeting_attendance WHERE attending=0 AND date BETWEEN ? AND ?').all(dateIso, weekEndIso);
    const excluded = new Set(excludedRows.map(r => `${r.uid}|${r.date}`));

    const mpRows = db.prepare(`
      SELECT mp.uid, mp.date, p.name AS project_name
      FROM meeting_projects mp JOIN projects p ON p.id = mp.project_id
      WHERE mp.date BETWEEN ? AND ?
    `).all(dateIso, weekEndIso);
    const mpMap = {};
    mpRows.forEach(r => { mpMap[`${r.uid}|${r.date}`] = r.project_name; });

    const outlookFormatted = outlookMeetings
      .filter(m => !excluded.has(`${m.uid}|${m.date}`))
      .map(m => {
        let s = `${m.date} `;
        if (m.allDay) s += '[Todo el día] ';
        else if (m.startTime) s += `${m.startTime}-${m.endTime || '?'} `;
        s += m.title;
        const proj = mpMap[`${m.uid}|${m.date}`];
        if (proj) s += ` (Proyecto: ${proj})`;
        return s;
      });

    const customMeetings = db.prepare(`
      SELECT id, date, title, start_time, end_time, all_day FROM custom_meetings
      WHERE date BETWEEN ? AND ? ORDER BY date, start_time
    `).all(dateIso, weekEndIso)
      .filter(cm => !excluded.has(`custom-${cm.id}|${cm.date}`))
      .map(m => {
        let s = `${m.date} `;
        if (m.all_day) s += '[Todo el día] ';
        else if (m.start_time) s += `${m.start_time}-${m.end_time || '?'} `;
        s += `${m.title} [custom]`;
        const proj = mpMap[`custom-${m.id}|${m.date}`];
        if (proj) s += ` (Proyecto: ${proj})`;
        return s;
      });

    ctx.reuniones = [...outlookFormatted, ...customMeetings];
  } catch (e) { console.error('[AI] Error reuniones:', e.message); ctx.reuniones = []; }

  // Notas de reuniones recientes
  try {
    ctx.notas_reuniones = db.prepare(`
      SELECT meeting_date, notes FROM meeting_notes
      WHERE notes != '' AND meeting_date >= date(?, '-7 days') AND meeting_date <= date(?, '+7 days')
      ORDER BY meeting_date DESC LIMIT 20
    `).all(dateIso, dateIso).map(n => `${n.meeting_date}: ${n.notes.slice(0, 200)}`);
  } catch (e) { console.error('[AI] Error notas:', e.message); ctx.notas_reuniones = []; }

  // Eventos
  try {
    ctx.eventos = db.prepare(`
      SELECT date, title, kind FROM events
      WHERE date BETWEEN date(?, '-3 days') AND date(?, '+14 days') ORDER BY date LIMIT 15
    `).all(dateIso, dateIso).map(ev => `${ev.date} ${ev.title} (${ev.kind})`);
  } catch (e) { console.error('[AI] Error eventos:', e.message); ctx.eventos = []; }

  // Días especiales (festivos, vacaciones) - rango más amplio
  try {
    ctx.dias_especiales = db.prepare(`
      SELECT date, type, label FROM labor_days
      WHERE date BETWEEN ? AND date(?, '+30 days') ORDER BY date LIMIT 20
    `).all(dateIso, dateIso).map(l => `${l.date} ${l.type}${l.label ? ` (${l.label})` : ''}`);
  } catch (e) { console.error('[AI] Error días especiales:', e.message); ctx.dias_especiales = []; }

  // Info de vacaciones
  try {
    const vacTotal = db.prepare("SELECT value FROM settings WHERE key='vacation_total'").get();
    const vacUsed = db.prepare("SELECT COUNT(*) as c FROM labor_days WHERE type='vacaciones'").get();
    if (vacTotal) {
      ctx.vacaciones = `${vacUsed?.c || 0} usados de ${vacTotal.value} totales (quedan ${vacTotal.value - (vacUsed?.c || 0)})`;
    }
  } catch (e) { console.error('[AI] Error vacaciones:', e.message); }

  return ctx;
}

export async function buildDailySnapshot(dateIso) {
  return await buildCompactContext(dateIso);
}

export async function saveDailySnapshot(dateIso) {
  const data = await buildDailySnapshot(dateIso);
  db.prepare(`
    INSERT INTO ai_snapshots(snapshot_date, data) VALUES(?, ?)
    ON CONFLICT(snapshot_date) DO UPDATE SET data=excluded.data, created_at=datetime('now')
  `).run(dateIso, JSON.stringify(data));
  return data;
}

// -------- Llamada a LM Studio --------

export async function chatWithAI(conversationId, userMessage) {
  const today = localIso();
  const context = await buildCompactContext(today);
  const contextStr = JSON.stringify(context);

  const systemPrompt = `Eres un asistente de agenda personal. Tienes acceso a datos reales del usuario.

DATOS:
${contextStr}

REGLAS:
- Responde en español, sé breve y directo.
- Usa los datos para responder sobre tareas, proyectos, horas, reuniones, notas de reuniones, eventos y calendario laboral.
- Si no tienes datos suficientes, dilo.
- Hoy es: ${today}`;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];

  try {
    console.log(`[AI] Enviando a LM Studio (${messages.length} msgs, contexto ${contextStr.length} chars)...`);
    const { status, data } = await httpPost(`${LM_STUDIO_URL}/v1/chat/completions`, {
      model: LM_MODEL,
      messages,
      temperature: 0.3,
      max_tokens: 2048,
      stream: false,
    });

    console.log(`[AI] Respuesta recibida: status ${status}`);

    if (status !== 200) {
      throw new Error(`LM Studio error ${status}: ${JSON.stringify(data)}`);
    }

    const choice = data.choices?.[0]?.message;
    const assistantMessage = choice?.content?.trim()
      || choice?.reasoning_content?.trim()
      || 'Sin respuesta del modelo.';
    return assistantMessage;
  } catch (err) {
    console.error('[AI] Error en LM Studio:', err.message);
    throw err;
  }
}

// -------- Cron diario a las 20:00 --------

function scheduleDailySnapshot() {
  const check = async () => {
    const now = new Date();
    if (now.getHours() === 20 && now.getMinutes() === 0) {
      const dateIso = localIso(now);
      try {
        await saveDailySnapshot(dateIso);
        console.log(`[AI] Snapshot diario guardado: ${dateIso}`);
      } catch (err) {
        console.error('[AI] Error guardando snapshot:', err.message);
      }
    }
  };
  setInterval(check, 60_000);

  // Generar snapshot inicial al arrancar
  const today = localIso();
  const existing = db.prepare('SELECT 1 FROM ai_snapshots WHERE snapshot_date = ?').get(today);
  if (!existing) {
    saveDailySnapshot(today).then(() => {
      console.log(`[AI] Snapshot inicial generado: ${today}`);
    }).catch(err => {
      console.error('[AI] Error en snapshot inicial:', err.message);
    });
  }
}

export function initAI() {
  scheduleDailySnapshot();
  console.log('[AI] Agente RAG iniciado — snapshot diario a las 20:00');
}
