// Helpers de fecha en hora LOCAL.
// new Date().toISOString() devuelve la fecha en UTC: en Madrid (UTC+1/+2),
// entre las 00:00 y la 01:00/02:00 el servidor creería que aún es "ayer".

export function localIso(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDaysIso(dateIso, days) {
  const d = new Date(dateIso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return localIso(d);
}
