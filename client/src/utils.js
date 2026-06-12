export const LABOR_TYPES = {
  laborable:    { label: 'Laborable',            color: '#ffffff', text: '#1a1f36' },
  finde:        { label: 'Fin de semana',        color: '#f1f5f9', text: '#64748b' },
  festivo_es:   { label: 'Festivos España',      color: '#fecaca', text: '#7f1d1d' },
  festivo_idom: { label: 'Festivos IDOM',        color: '#c7d2fe', text: '#312e81' },
  festivo_auton:{ label: 'Festivos c. autónoma', color: '#bbf7d0', text: '#14532d' },
  festivo_local:{ label: 'Festivos locales',     color: '#a5f3fc', text: '#155e75' },
  vacaciones:   { label: 'Vacaciones',           color: '#fde68a', text: '#713f12' },
};

export const LABOR_ORDER = [
  'laborable', 'finde', 'festivo_es', 'festivo_idom',
  'festivo_auton', 'festivo_local', 'vacaciones'
];

export function iso(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

export function monthMatrix(year, month /* 0-11 */) {
  // Lunes a domingo
  const first = new Date(year, month, 1);
  const startOffset = (first.getDay() + 6) % 7; // 0 = lunes
  const start = addDays(first, -startOffset);
  const weeks = [];
  for (let w = 0; w < 6; w++) {
    const row = [];
    for (let d = 0; d < 7; d++) row.push(addDays(start, w * 7 + d));
    weeks.push(row);
  }
  return weeks;
}

export const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

export const DOW = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

export function diffMinutes(start, end) {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  return (eh * 60 + em) - (sh * 60 + sm);
}

export function fmtHours(minutes) {
  if (minutes <= 0) return '0h';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function calcMeetingHours(meetings = []) {
  return meetings.reduce((total, m) => {
    if (m.attending === false || m.attending === 0) return total;
    if (m.allDay || !m.startTime || !m.endTime) return total;
    const [sh, sm] = m.startTime.split(':').map(Number);
    const [eh, em] = m.endTime.split(':').map(Number);
    const mins = (eh * 60 + em) - (sh * 60 + sm);
    return total + (mins > 0 ? mins / 60 : 0);
  }, 0);
}

export function isWeekend(date) {
  const d = date.getDay();
  return d === 0 || d === 6;
}

// Devuelve el "tipo efectivo" del día: el del backend si existe, si no laborable/finde por defecto
export function effectiveLabor(date, laborMap = {}) {
  const key = iso(date);
  if (laborMap && laborMap[key]) return laborMap[key];
  if (isWeekend(date)) return { type: 'finde', label: null };
  return { type: 'laborable', label: null };
}

export function availableWorkHoursForDate(date, laborMap = {}) {
  const effectiveType = effectiveLabor(date, laborMap);
  if (effectiveType.type !== 'laborable') return 0;

  const day = date.getDay();
  if (day === 5) return 6;
  if (day >= 1 && day <= 4) return 8.75;
  return 0;
}

export function availableWorkHoursForMonth(year, month, laborMap = {}) {
  const lastDay = new Date(year, month + 1, 0).getDate();
  let total = 0;

  for (let day = 1; day <= lastDay; day += 1) {
    total += availableWorkHoursForDate(new Date(year, month, day), laborMap);
  }

  return total;
}
