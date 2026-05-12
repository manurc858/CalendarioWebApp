import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(__dirname, 'agenda.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL DEFAULT '#4f8cff',
    expected_hours REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS work_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,             -- YYYY-MM-DD
    start_time TEXT NOT NULL,       -- HH:MM
    end_time TEXT NOT NULL,         -- HH:MM
    project_id INTEGER,
    note TEXT,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS todos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT,
    text TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    title TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'event'  -- 'event' | 'delivery'
  );

  -- Calendario laboral: tipo de día
  -- types: 'laborable' (blanco), 'finde' (gris), 'festivo_es' (rojo),
  --        'festivo_idom' (azul), 'festivo_auton' (verde), 'festivo_local' (cian),
  --        'vacaciones' (amarillo)
  CREATE TABLE IF NOT EXISTS labor_days (
    date TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    label TEXT
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS project_month_hours (
    project_id INTEGER NOT NULL,
    month TEXT NOT NULL,
    hours REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (project_id, month),
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
  );
`);

// Migration: allow NULL date in todos for unassigned tasks
try {
  const cols = db.prepare("PRAGMA table_info(todos)").all();
  const dateCol = cols.find(c => c.name === 'date');
  if (dateCol && dateCol.notnull === 1) {
    db.exec(`
      CREATE TABLE todos_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT,
        text TEXT NOT NULL,
        done INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO todos_new SELECT * FROM todos;
      DROP TABLE todos;
      ALTER TABLE todos_new RENAME TO todos;
    `);
  }
} catch (e) {
  console.error('Migration error:', e.message);
}

// ajustes por defecto
const hasSetting = db.prepare('SELECT 1 FROM settings WHERE key = ?');
const setSetting = db.prepare('INSERT INTO settings(key, value) VALUES(?, ?)');
if (!hasSetting.get('vacation_total')) setSetting.run('vacation_total', '23');

// migración suave: añade expected_hours si el schema es antiguo
try {
  const cols = db.prepare("PRAGMA table_info(projects)").all();
  if (!cols.find(c => c.name === 'expected_hours')) {
    db.exec('ALTER TABLE projects ADD COLUMN expected_hours REAL NOT NULL DEFAULT 0');
  }
} catch (_) { /* ignore */ }

// migración: añade description y links a projects
try {
  const pCols = db.prepare("PRAGMA table_info(projects)").all();
  if (!pCols.find(c => c.name === 'description')) {
    db.exec("ALTER TABLE projects ADD COLUMN description TEXT NOT NULL DEFAULT ''");
  }
  if (!pCols.find(c => c.name === 'links')) {
    db.exec("ALTER TABLE projects ADD COLUMN links TEXT NOT NULL DEFAULT ''");
  }
} catch (_) { /* ignore */ }

// migración: añade columna hours a work_entries
try {
  const wCols = db.prepare("PRAGMA table_info(work_entries)").all();
  if (!wCols.find(c => c.name === 'hours')) {
    db.exec('ALTER TABLE work_entries ADD COLUMN hours REAL NOT NULL DEFAULT 0');
    // migrar datos existentes: calcular hours a partir de start_time/end_time
    db.exec(`UPDATE work_entries SET hours = ROUND(
      ((CAST(substr(end_time,1,2) AS REAL)*60 + CAST(substr(end_time,4,2) AS REAL)) -
       (CAST(substr(start_time,1,2) AS REAL)*60 + CAST(substr(start_time,4,2) AS REAL))) / 60.0, 2
    ) WHERE hours = 0 AND start_time IS NOT NULL AND end_time IS NOT NULL`);
  }
} catch (_) { /* ignore */ }

// tabla meeting_projects: vincula reuniones (uid+date) a proyectos
db.exec(`
  CREATE TABLE IF NOT EXISTS meeting_projects (
    uid TEXT NOT NULL,
    date TEXT NOT NULL,
    project_id INTEGER NOT NULL,
    PRIMARY KEY (uid, date),
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
  );
`);

// tabla custom_meetings: reuniones creadas por el usuario
db.exec(`
  CREATE TABLE IF NOT EXISTS custom_meetings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    title TEXT NOT NULL,
    start_time TEXT,
    end_time TEXT,
    all_day INTEGER NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    links TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// tabla meeting_notes: notas para cualquier reunión (outlook uid o custom id)
db.exec(`
  CREATE TABLE IF NOT EXISTS meeting_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    meeting_type TEXT NOT NULL,      -- 'outlook' | 'custom'
    meeting_ref TEXT NOT NULL,        -- uid for outlook, id for custom
    meeting_date TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    links TEXT NOT NULL DEFAULT '',
    UNIQUE(meeting_type, meeting_ref, meeting_date)
  );
`);

export default db;
