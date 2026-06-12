// Migra TODOS los datos de la base SQLite local (agenda.db) a Supabase/Postgres.
// Uso:
//   1. Define DATABASE_URL en server/.env (connection string de Supabase).
//   2. node migrate-to-supabase.js
// Es idempotente: vacía las tablas destino antes de copiar (TRUNCATE ... CASCADE).
import './env.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (!process.env.DATABASE_URL) {
  console.error('ERROR: define DATABASE_URL en server/.env (Supabase → Settings → Database → Connection string).');
  process.exit(1);
}

const sqlite = new Database(path.join(__dirname, 'agenda.db'), { readonly: true });
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 3,
});

// Crear el esquema en Postgres reutilizando initDb() del adaptador.
// Forzamos el backend PG (DATABASE_URL ya está definida).
const { initDb } = await import('./db.js');
await initDb();

// (tabla, columnas, ¿tiene secuencia id?) en orden compatible con las FK
const TABLES = [
  ['projects',               ['id', 'name', 'color', 'expected_hours', 'description', 'links', 'created_at'], true],
  ['work_entries',           ['id', 'date', 'start_time', 'end_time', 'hours', 'project_id', 'note'], true],
  ['todos',                  ['id', 'date', 'text', 'done', 'sort_order', 'parent_id'], true],
  ['events',                 ['id', 'date', 'title', 'kind'], true],
  ['labor_days',             ['date', 'type', 'label'], false],
  ['settings',               ['key', 'value'], false],
  ['project_month_hours',    ['project_id', 'month', 'hours'], false],
  ['outlook_meetings_cache', ['id', 'uid', 'date', 'title', 'start_time', 'end_time', 'all_day', 'teams_url', 'cached_at'], true],
  ['meeting_projects',       ['uid', 'date', 'project_id'], false],
  ['custom_meetings',        ['id', 'date', 'title', 'start_time', 'end_time', 'all_day', 'notes', 'links', 'repeat', 'repeat_until', 'created_at'], true],
  ['meeting_notes',          ['id', 'meeting_type', 'meeting_ref', 'meeting_date', 'notes', 'links'], true],
  ['meeting_attendance',     ['uid', 'date', 'attending'], false],
  ['chat_conversations',     ['id', 'title', 'created_at', 'updated_at'], true],
  ['chat_messages',          ['id', 'conversation_id', 'role', 'content', 'created_at'], true],
  ['ai_snapshots',           ['id', 'snapshot_date', 'data', 'created_at'], true],
];

function sqliteColumns(table) {
  return sqlite.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
}

const client = await pool.connect();
try {
  await client.query('BEGIN');

  // Vaciar destino en orden inverso (las FK con CASCADE lo permiten igual)
  await client.query(`TRUNCATE ${TABLES.map(([t]) => t).join(', ')} RESTART IDENTITY CASCADE`);

  for (const [table, cols, hasIdSeq] of TABLES) {
    const available = new Set(sqliteColumns(table));
    const usableCols = cols.filter(c => available.has(c));
    if (usableCols.length === 0) { console.log(`- ${table}: tabla no existe en SQLite, omitida`); continue; }

    const quotedCols = usableCols.map(c => `"${c}"`);
    const rows = sqlite.prepare(`SELECT ${quotedCols.join(', ')} FROM ${table}`).all();
    if (rows.length === 0) { console.log(`- ${table}: 0 filas`); continue; }

    const placeholders = usableCols.map((_, i) => `$${i + 1}`).join(', ');
    const insertSql = `INSERT INTO ${table}(${quotedCols.join(', ')}) VALUES(${placeholders})`;
    for (const row of rows) {
      await client.query(insertSql, usableCols.map(c => row[c] ?? null));
    }

    if (hasIdSeq) {
      await client.query(
        `SELECT setval(pg_get_serial_sequence('${table}', 'id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM ${table}), 1))`
      );
    }
    console.log(`- ${table}: ${rows.length} filas copiadas`);
  }

  await client.query('COMMIT');
  console.log('\n✅ Migración completada. El servidor usará Supabase mientras DATABASE_URL esté definida.');
} catch (err) {
  await client.query('ROLLBACK');
  console.error('\n❌ Migración fallida (no se ha modificado nada):', err.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
  sqlite.close();
  // db.js mantiene su propio pool abierto; salir explícitamente
  process.exit(process.exitCode || 0);
}
