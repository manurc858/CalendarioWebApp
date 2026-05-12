// Self-contained ICS parser + fetcher with 1-hour cache
// Handles: non-recurring events, RRULE (DAILY/WEEKLY/MONTHLY with BYDAY, COUNT, UNTIL, INTERVAL, EXDATE)

import db from './db.js';

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function getIcsUrl() {
  const envUrl = (process.env.OUTLOOK_ICS_URL || '').trim();
  if (envUrl) return envUrl;

  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('outlook_ics_url');
  if (row?.value && String(row.value).trim()) return String(row.value).trim();

  return null;
}

let cache = { at: 0, rawEvents: [] };

function unfold(text) { return text.replace(/\r?\n[ \t]/g, ''); }
function unescapeIcs(s) { return s.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\'); }
function pad2(n) { return String(n).padStart(2, '0'); }
function isoOf(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }

// Target timezone for display
const TARGET_TZ = 'Europe/Madrid';

// Map Windows timezone names to IANA
const WIN_TZ_MAP = {
  'Romance Standard Time': 'Europe/Madrid',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Central European Standard Time': 'Europe/Budapest',
  'Central Europe Standard Time': 'Europe/Prague',
  'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'Eastern Standard Time': 'America/New_York',
  'Pacific Standard Time': 'America/Los_Angeles',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'UTC': 'UTC',
};

function resolveTimezone(tzid) {
  if (!tzid) return null;
  return WIN_TZ_MAP[tzid] || tzid;
}

function toLocalDate(utcDate) {
  // Convert a UTC Date to a Date whose local fields match TARGET_TZ
  const s = utcDate.toLocaleString('sv-SE', { timeZone: TARGET_TZ });
  return new Date(s.replace(' ', 'T'));
}

function parseIcsDate(val, tzid) {
  const ianaTz = resolveTimezone(tzid);
  if (/^\d{8}$/.test(val)) {
    const y = +val.slice(0, 4), m = +val.slice(4, 6) - 1, d = +val.slice(6, 8);
    return { date: new Date(y, m, d), allDay: true };
  }
  if (/^\d{8}T\d{6}Z?$/.test(val)) {
    const y = +val.slice(0, 4), mo = +val.slice(4, 6) - 1, da = +val.slice(6, 8);
    const h = +val.slice(9, 11), mi = +val.slice(11, 13), s = +val.slice(13, 15);
    if (val.endsWith('Z')) {
      // UTC → convert to Madrid local
      const utc = new Date(Date.UTC(y, mo, da, h, mi, s));
      return { date: toLocalDate(utc), allDay: false };
    }
    if (ianaTz) {
      // Has TZID → interpret in that timezone, then convert to Madrid
      const faux = new Date(Date.UTC(y, mo, da, h, mi, s));
      // Get the offset of the source tz at that moment
      const srcStr = faux.toLocaleString('sv-SE', { timeZone: ianaTz });
      const srcDate = new Date(srcStr.replace(' ', 'T') + 'Z'); // treat as UTC
      const diff = faux - srcDate; // ms offset of source tz
      const utc = new Date(faux.getTime() + diff);
      return { date: toLocalDate(utc), allDay: false };
    }
    // No Z, no TZID → assume local time already
    return { date: new Date(y, mo, da, h, mi, s), allDay: false };
  }
  return { date: new Date(val), allDay: false };
}

function parseIcs(text) {
  const lines = unfold(text).split(/\r?\n/);
  const events = [];
  let cur = null, inEvent = false;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = { exdates: [] }; inEvent = true; }
    else if (line === 'END:VEVENT') { if (cur) events.push(cur); cur = null; inEvent = false; }
    else if (inEvent && cur) {
      const colon = line.indexOf(':');
      if (colon < 0) continue;
      const params = line.slice(0, colon).split(';');
      const key = params[0];
      const value = line.slice(colon + 1);
      const tzidParam = params.find(p => p.startsWith('TZID='));
      const tzid = tzidParam ? tzidParam.slice(5) : null;
      if (key === 'SUMMARY') cur.summary = unescapeIcs(value);
      else if (key === 'DTSTART') cur.start = parseIcsDate(value, tzid);
      else if (key === 'DTEND') cur.end = parseIcsDate(value, tzid);
      else if (key === 'LOCATION') cur.location = unescapeIcs(value);
      else if (key === 'DESCRIPTION') cur.description = unescapeIcs(value);
      else if (key === 'UID') cur.uid = value;
      else if (key === 'RRULE') cur.rrule = value;
      else if (key === 'EXDATE') {
        value.split(',').forEach(v => cur.exdates.push(isoOf(parseIcsDate(v, tzid).date)));
      }
      else if (key === 'X-MICROSOFT-SKYPETEAMSMEETINGURL') cur.teamsUrl = value;
      else if (key === 'STATUS') cur.status = value;
    }
  }
  return events;
}

const DAY_MAP = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function expandRrule(ev, rangeStart, rangeEnd) {
  const rules = {};
  ev.rrule.split(';').forEach(p => { const [k, v] = p.split('='); rules[k] = v; });
  const freq = rules.FREQ;
  const interval = parseInt(rules.INTERVAL || '1', 10);
  const until = rules.UNTIL ? parseIcsDate(rules.UNTIL).date : null;
  const count = rules.COUNT ? parseInt(rules.COUNT, 10) : Infinity;
  const byDays = rules.BYDAY ? rules.BYDAY.split(',').map(s => s.slice(-2)) : null;

  const baseStart = ev.start.date;
  const duration = ev.end ? (ev.end.date - baseStart) : 0;
  const exdates = ev.exdates || [];
  const occurrences = [];
  let iter = 0, produced = 0;
  const maxIter = 2000;

  if (freq === 'DAILY') {
    let cur = new Date(baseStart);
    while (iter++ < maxIter && produced < count) {
      if (until && cur > until) break;
      if (cur > rangeEnd) break;
      if (!exdates.includes(isoOf(cur)) && cur >= rangeStart) occurrences.push(new Date(cur));
      produced++;
      cur.setDate(cur.getDate() + interval);
    }
  } else if (freq === 'WEEKLY') {
    const daysToEmit = byDays ? byDays.map(d => DAY_MAP[d]) : [baseStart.getDay()];
    let weekStart = new Date(baseStart);
    const dow = weekStart.getDay();
    const isoDow = dow === 0 ? 6 : dow - 1;
    weekStart.setDate(weekStart.getDate() - isoDow);

    outer: while (iter++ < maxIter && produced < count) {
      const sorted = daysToEmit.slice().sort((a, b) => ((a === 0 ? 7 : a) - (b === 0 ? 7 : b)));
      for (const dayNum of sorted) {
        const occ = new Date(weekStart);
        const offset = dayNum === 0 ? 6 : dayNum - 1;
        occ.setDate(weekStart.getDate() + offset);
        if (occ < baseStart) continue;
        if (until && occ > until) break outer;
        if (occ > rangeEnd) break outer;
        if (!exdates.includes(isoOf(occ)) && occ >= rangeStart) occurrences.push(new Date(occ));
        produced++;
        if (produced >= count) break outer;
      }
      weekStart.setDate(weekStart.getDate() + 7 * interval);
    }
  } else if (freq === 'MONTHLY') {
    let cur = new Date(baseStart);
    while (iter++ < maxIter && produced < count) {
      if (until && cur > until) break;
      if (cur > rangeEnd) break;
      if (!exdates.includes(isoOf(cur)) && cur >= rangeStart) occurrences.push(new Date(cur));
      produced++;
      cur.setMonth(cur.getMonth() + interval);
    }
  } else {
    if (baseStart >= rangeStart && baseStart <= rangeEnd) occurrences.push(new Date(baseStart));
  }

  return occurrences.map(start => ({
    uid: ev.uid, summary: ev.summary, description: ev.description, location: ev.location,
    teamsUrl: ev.teamsUrl, status: ev.status,
    start: { date: start, allDay: ev.start.allDay },
    end: ev.end ? { date: new Date(start.getTime() + duration), allDay: ev.end.allDay } : null,
  }));
}

function extractTeamsLink(ev) {
  if (ev.teamsUrl) return ev.teamsUrl;
  const text = (ev.description || '') + '\n' + (ev.location || '');
  const m = text.match(/https:\/\/teams\.microsoft\.com\/l\/meetup-join\/[^\s"'<>)\]]+/i);
  return m ? m[0] : null;
}

export async function refreshMeetings(force = false) {
  const now = Date.now();
  if (!force && now - cache.at < CACHE_TTL_MS && cache.rawEvents.length) return cache.rawEvents;
  const url = getIcsUrl();
  if (!url) {
    cache.rawEvents = [];
    cache.at = now;
    return [];
  }
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    cache.rawEvents = parseIcs(text);
    cache.at = now;
    console.log(`[outlook] Cached ${cache.rawEvents.length} events`);
    return cache.rawEvents;
  } catch (err) {
    console.error('[outlook] fetch error:', err.message);
    return cache.rawEvents || [];
  }
}

export async function getMeetingsInRange(fromIso, toIso) {
  await refreshMeetings();
  const rangeStart = new Date(fromIso + 'T00:00:00');
  const rangeEnd = new Date(toIso + 'T23:59:59');
  const out = [];
  for (const ev of cache.rawEvents) {
    if (!ev.start) continue;
    if (ev.status === 'CANCELLED') continue;
    if (ev.rrule) out.push(...expandRrule(ev, rangeStart, rangeEnd));
    else if (ev.start.date >= rangeStart && ev.start.date <= rangeEnd) out.push(ev);
  }
  return out.map(ev => {
    const s = ev.start.date, e = ev.end?.date || s;
    return {
      uid: ev.uid,
      date: isoOf(s),
      title: ev.summary || '(Sin título)',
      startTime: ev.start.allDay ? null : `${pad2(s.getHours())}:${pad2(s.getMinutes())}`,
      endTime: ev.end && !ev.end.allDay ? `${pad2(e.getHours())}:${pad2(e.getMinutes())}` : null,
      teamsUrl: extractTeamsLink(ev),
      allDay: !!ev.start.allDay,
    };
  }).sort((a, b) => a.date !== b.date ? (a.date < b.date ? -1 : 1) : (a.startTime || '').localeCompare(b.startTime || ''));
}

export async function getMeetingsForDate(dateIso) {
  return getMeetingsInRange(dateIso, dateIso);
}

refreshMeetings().catch(() => {});
