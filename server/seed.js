import db from './db.js';

// Calendario laboral Madrid 2026 (según imagen proporcionada)
const holidays = [
  // Festivos España (rojo)
  ['2026-01-01', 'festivo_es',    'Año nuevo'],
  ['2026-01-06', 'festivo_es',    'Epifanía del Señor'],
  ['2026-04-03', 'festivo_es',    'Viernes Santo'],
  ['2026-05-01', 'festivo_es',    'Fiesta del trabajo'],
  ['2026-08-15', 'festivo_es',    'Asunción de la Virgen'],
  ['2026-10-12', 'festivo_es',    'Fiesta Nacional de España'],
  ['2026-12-08', 'festivo_es',    'La Inmaculada Concepción'],
  ['2026-12-25', 'festivo_es',    'Natividad del Señor'],
  // Festivos autonómicos (verde)
  ['2026-04-02', 'festivo_auton', 'Jueves Santo'],
  ['2026-05-02', 'festivo_auton', 'Día de la Comunidad de Madrid'],
  ['2026-11-02', 'festivo_auton', 'Día de todos los Santos (se pasa al lunes)'],
  ['2026-12-07', 'festivo_auton', 'Día de la Constitución (se pasa al lunes)'],
  // Festivos locales (cian)
  ['2026-05-15', 'festivo_local', 'San Isidro'],
  ['2026-11-09', 'festivo_local', 'La Almudena'],
  // Festivos IDOM (azul)
  ['2026-04-06', 'festivo_idom',  'Lunes de Pascua'],
  ['2026-09-25', 'festivo_idom',  'San IDOM'],
  ['2026-12-24', 'festivo_idom',  'Nochebuena'],
  ['2026-12-31', 'festivo_idom',  'Nochevieja'],
];

const upsert = db.prepare(`INSERT INTO labor_days(date, type, label) VALUES(?,?,?)
  ON CONFLICT(date) DO UPDATE SET type=excluded.type, label=excluded.label`);

const tx = db.transaction(() => {
  // findes del año (si no están ya marcados)
  const start = new Date('2026-01-01');
  const end = new Date('2026-12-31');
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay(); // 0 dom, 6 sab
    if (dow === 0 || dow === 6) {
      const iso = d.toISOString().slice(0, 10);
      const existing = db.prepare('SELECT * FROM labor_days WHERE date=?').get(iso);
      if (!existing) upsert.run(iso, 'finde', null);
    }
  }
  for (const [date, type, label] of holidays) upsert.run(date, type, label);
});
tx();

console.log('Seed completado: calendario laboral Madrid 2026.');
