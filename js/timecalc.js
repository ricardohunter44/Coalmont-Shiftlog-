// Jobflow time math. Pure functions, no DOM, so they can be tested on their own.
// An entry: { date:'YYYY-MM-DD', start:'HH:MM', end:'HH:MM'|'' (blank = still on the clock), breakMin, otAt:'HH:MM'|'' }
// Overtime rule: minutes worked after the day type's cutoff clock time (otAt) are overtime.
// Unpaid break comes out of regular time first, then overtime.

export const pad = n => String(n).padStart(2, '0');

export function toMin(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

export function isoDate(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
export function parseISO(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); }
export function addDays(iso, n) { const d = parseISO(iso); d.setDate(d.getDate() + n); return isoDate(d); }
export function nowHHMM(d = new Date()) { return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }

// Minutes from the entry date's midnight to `now` (can exceed 1440 for a shift that ran past midnight).
function minutesSinceDateStart(iso, now) {
  const start = parseISO(iso);
  return Math.floor((now - start) / 60000);
}

export function calcEntry(e, now = new Date()) {
  const s = toMin(e.start);
  if (s == null) return { total: 0, reg: 0, ot: 0, running: false, valid: false };
  let end, running = false;
  if (e.end) {
    end = toMin(e.end);
    if (end == null) return { total: 0, reg: 0, ot: 0, running: false, valid: false };
    if (end <= s) end += 1440; // worked past midnight
  } else {
    running = true;
    end = Math.max(s, minutesSinceDateStart(e.date, now));
  }
  const worked = end - s;
  const cut = toMin(e.otAt);
  let ot = cut == null ? 0 : Math.max(0, end - Math.max(s, cut));
  let reg = worked - ot;
  let brk = running ? 0 : Math.max(0, Math.min(+e.breakMin || 0, worked));
  const fromReg = Math.min(brk, reg); reg -= fromReg; brk -= fromReg;
  ot -= Math.min(brk, ot);
  return { total: reg + ot, reg, ot, running, valid: true };
}

export function weekStartISO(iso, startDow = 1) {
  const d = parseISO(iso);
  const back = (d.getDay() - startDow + 7) % 7;
  d.setDate(d.getDate() - back);
  return isoDate(d);
}

export function sumEntries(entries, now = new Date()) {
  const out = { total: 0, reg: 0, ot: 0, byType: {} };
  for (const e of entries) {
    const c = calcEntry(e, now);
    out.total += c.total; out.reg += c.reg; out.ot += c.ot;
    const t = e.dayType || 'Other';
    if (!out.byType[t]) out.byType[t] = { days: new Set(), total: 0 };
    out.byType[t].days.add(e.date); out.byType[t].total += c.total;
  }
  return out;
}

export const fmtHM = m => `${Math.floor(Math.round(m) / 60)}:${pad(Math.round(m) % 60)}`;
export const fmtDec = m => (Math.round(m) / 60).toFixed(2);
