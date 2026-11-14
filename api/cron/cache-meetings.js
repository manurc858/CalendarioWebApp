// Vercel Cron Job (ver vercel.json) — sustituye al setInterval diario que
// usa server/index.js fuera de Vercel, ya que aquí no hay proceso persistente.
import '../../server/env.js';
import { initDb } from '../../server/db.js';
import { cacheOutlookMeetings } from '../../server/meetingsCache.js';

export default async function handler(req, res) {
  // Si se define CRON_SECRET en Vercel, exige la cabecera para que el
  // endpoint no sea disparable públicamente por cualquiera.
  if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  try {
    await initDb();
    const count = await cacheOutlookMeetings();
    res.json({ ok: true, count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
