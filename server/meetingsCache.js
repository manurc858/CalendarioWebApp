// Copia las reuniones de Outlook (hoy + próximos 30 días) a outlook_meetings_cache.
// Compartido entre el cron local (server/index.js) y el cron serverless de Vercel.
import { dbRun } from './db.js';
import { getMeetingsInRange } from './outlook.js';
import { localIso, addDaysIso } from './dates.js';

export async function cacheOutlookMeetings() {
  const today = localIso();
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
    return meetings.length;
  } catch (err) {
    console.error('[cache] Error copiando reuniones Outlook:', err.message);
    throw err;
  }
}
