// Verificación: compara fila a fila los recuentos SQLite local vs Supabase
import './env.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlite = new Database(path.join(__dirname, 'agenda.db'), { readonly: true });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 });

const tables = ['projects','work_entries','todos','events','labor_days','settings','project_month_hours',
  'outlook_meetings_cache','meeting_projects','custom_meetings','meeting_notes','meeting_attendance',
  'chat_conversations','chat_messages','ai_snapshots'];

console.log('TABLA'.padEnd(26) + 'SQLite'.padStart(8) + 'Supabase'.padStart(10));
let allOk = true;
for (const t of tables) {
  const s = sqlite.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c;
  const p = Number((await pool.query(`SELECT COUNT(*) AS c FROM ${t}`)).rows[0].c);
  const mark = s === p ? 'OK' : '  <-- DIFIEREN';
  if (s !== p) allOk = false;
  console.log(t.padEnd(26) + String(s).padStart(8) + String(p).padStart(10) + '  ' + mark);
}

// Muestra de reuniones guardadas en Supabase
const cm = await pool.query('SELECT id, date, title, repeat FROM custom_meetings ORDER BY date');
console.log('\nReuniones propias en Supabase:');
cm.rows.forEach(r => console.log(`  #${r.id} ${r.date} "${r.title}" (repeat: ${r.repeat})`));
const om = await pool.query('SELECT COUNT(*) AS c, MIN(date) AS min, MAX(date) AS max FROM outlook_meetings_cache');
console.log(`Cache Outlook en Supabase: ${om.rows[0].c} reuniones (${om.rows[0].min} a ${om.rows[0].max})`);
const mn = await pool.query('SELECT meeting_type, meeting_date FROM meeting_notes ORDER BY meeting_date');
console.log(`Notas de reunion: ${mn.rows.length} -> ` + mn.rows.map(r => `${r.meeting_type}@${r.meeting_date}`).join(', '));

console.log(allOk ? '\nTODAS LAS TABLAS COINCIDEN' : '\nHAY DIFERENCIAS');
await pool.end(); sqlite.close(); process.exit(0);
