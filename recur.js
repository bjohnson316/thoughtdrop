/* ThoughtDrop repeat rules — shared by the app (window.Recur) and the GitHub Action (require).
   A rule: {freq:'daily'|'weekly'|'monthly'|'yearly', every:N, start:ISO, days?:[0-6], day?:1-31, until?:'YYYY-MM-DD', count?:N} */
(function (g) {
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const DAYRX = '(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tues|tue|wed|thurs|thur|thu|fri|sat)s?';
  const DAYIX = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  const NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, other: 2 };
  const num = s => /^\d+$/.test(s) ? +s : (NUM[s] || 1);
  const eod = s => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d, 23, 59, 59, 999); };
  const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const ord = n => n + (n % 100 > 10 && n % 100 < 14 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');

  function valid(r) {
    return r && ['daily', 'weekly', 'monthly', 'yearly'].includes(r.freq) && !isNaN(Date.parse(r.start));
  }

  // Every occurrence of the rule, in order, starting at r.start.
  function* occs(r) {
    const a = new Date(r.start), every = Math.max(1, Math.min(999, +r.every || 1));
    if (r.freq === 'weekly' && Array.isArray(r.days) && r.days.length) {
      const days = [...new Set(r.days.map(Number).filter(d => d >= 0 && d < 7))].sort();
      const sow = new Date(a.getFullYear(), a.getMonth(), a.getDate() - a.getDay());
      for (let w = 0; w < 100000; w += every) for (const dd of days) {
        const d = new Date(sow.getFullYear(), sow.getMonth(), sow.getDate() + w * 7 + dd, a.getHours(), a.getMinutes());
        if (d >= a) yield d;
      }
      return;
    }
    const day = r.day || a.getDate();
    for (let k = 0; k < 100000; k++) {
      const m = k * every;
      if (r.freq === 'daily') yield new Date(a.getFullYear(), a.getMonth(), a.getDate() + m, a.getHours(), a.getMinutes());
      else if (r.freq === 'weekly') yield new Date(a.getFullYear(), a.getMonth(), a.getDate() + 7 * m, a.getHours(), a.getMinutes());
      else {
        const y = a.getFullYear() + (r.freq === 'yearly' ? m : 0), mo = a.getMonth() + (r.freq === 'monthly' ? m : 0);
        const dim = new Date(y, mo + 1, 0).getDate();
        yield new Date(y, mo, Math.min(day, dim), a.getHours(), a.getMinutes());
      }
    }
  }

  // Occurrences between from and to (inclusive), respecting the end rule.
  function list(r, from, to, max = 500) {
    const out = []; if (!valid(r)) return out; let i = 0;
    for (const d of occs(r)) {
      if (r.count && i >= r.count) break;
      if (r.until && d > eod(r.until)) break;
      if (d > to) break;
      if (d >= from) out.push(d);
      if (++i > 200000 || out.length >= max) break;
    }
    return out;
  }

  // First occurrence strictly after time T, or null when the series has ended.
  function nextAfter(r, T) {
    if (!valid(r)) return null; let i = 0;
    for (const d of occs(r)) {
      if (r.count && i >= r.count) return null;
      if (r.until && d > eod(r.until)) return null;
      if (d > T) return d;
      if (++i > 200000) return null;
    }
    return null;
  }

  // Move a repeating note to its next occurrence after now (or after its current due time). False if the series is over.
  function advance(n, now) {
    const t = new Date(Math.max(+now, Date.parse(n.due) || 0));
    const nx = nextAfter(n.repeat, t);
    if (!nx) return false;
    n.due = nx.toISOString(); n.notified = false; return true;
  }

  function describe(r) {
    if (!valid(r)) return '';
    const a = new Date(r.start), ev = +r.every > 1 ? +r.every : 0; let s;
    if (r.freq === 'daily') s = ev ? `Every ${ev} days` : 'Daily';
    else if (r.freq === 'weekly') {
      const ds = r.days && r.days.length ? [...r.days].sort().map(d => DAYS[d]) : [DAYS[a.getDay()]];
      const label = ds.join(',') === 'Mon,Tue,Wed,Thu,Fri' ? 'weekdays' : ds.join(', ');
      s = `${ev ? (ev === 2 ? 'Every other week' : `Every ${ev} weeks`) : 'Weekly'} on ${label}`;
    } else if (r.freq === 'monthly') s = `${ev ? (ev === 3 ? 'Quarterly' : `Every ${ev} months`) : 'Monthly'} on the ${ord(r.day || a.getDate())}`;
    else s = `${ev ? `Every ${ev} years` : 'Yearly'} on ${a.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
    if (r.until) s += ` until ${eod(r.until).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}`;
    if (r.count) s += ` · ${r.count} times`;
    return s;
  }

  // Read a repeat rule out of plain text. Returns {repeat, hits} (hits = phrases to strip) or null.
  function parse(text, now = new Date()) {
    const low = ' ' + String(text).toLowerCase() + ' ', hits = []; let m, r = null;
    const take = re => { const x = low.match(re); if (x) hits.push(x[0].trim()); return x; };
    if (take(/\bevery weekday\b/)) r = { freq: 'weekly', every: 1, days: [1, 2, 3, 4, 5] };
    else if (take(/\bevery weekend\b/)) r = { freq: 'weekly', every: 1, days: [0, 6] };
    else if ((m = take(/\b(?:of )?(?:every|each) (other |\d+ |two |three |four |six |twelve )?(day|week|month|year)s?\b/)))
      r = { freq: { day: 'daily', week: 'weekly', month: 'monthly', year: 'yearly' }[m[2]], every: m[1] ? num(m[1].trim()) : 1 };
    else if ((m = take(/\b(daily|nightly|weekly|biweekly|fortnightly|monthly|quarterly|yearly|annually)\b/)))
      r = { daily: ['daily', 1], nightly: ['daily', 1], weekly: ['weekly', 1], biweekly: ['weekly', 2], fortnightly: ['weekly', 2], monthly: ['monthly', 1], quarterly: ['monthly', 3], yearly: ['yearly', 1], annually: ['yearly', 1] }[m[1]]
        .reduce((f, e) => ({ freq: f, every: e }));
    if (!r && new RegExp('\\b(?:every|each) ' + DAYRX + '\\b').test(low)) r = { freq: 'weekly', every: 1 };
    if (!r) return null;
    if (r.freq === 'weekly' && !r.days) {
      const dl = take(new RegExp('\\b(?:on |every |each )?' + DAYRX + '(?:\\s*(?:,|and|&|/)\\s*' + DAYRX + ')*\\b'));
      if (dl) r.days = [...new Set((dl[0].match(/(sun|mon|tue|wed|thu|fri|sat)/g) || []).map(d => DAYIX[d]))].sort();
    }
    if (r.freq === 'monthly' && (m = take(/\b(?:on )?the (\d{1,2})(?:st|nd|rd|th)\b/)) && +m[1] >= 1 && +m[1] <= 31) r.day = +m[1];
    if ((m = take(/\bfor (?:the )?(?:next )?(\d+|an?|one|two|three|four|five|six|seven|eight|nine|ten|twelve) (days?|weeks?|months?|years?)\b/))) {
      const k = num(m[1]), u = m[2][0], d = new Date(now);
      if (u === 'd') d.setDate(d.getDate() + k); else if (u === 'w') d.setDate(d.getDate() + 7 * k);
      else if (u === 'm') d.setMonth(d.getMonth() + k); else d.setFullYear(d.getFullYear() + k);
      r.until = ymd(d);
    } else if ((m = take(/\b(?:until|through|thru|till) (\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/))) {
      const y = m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : now.getFullYear();
      r.until = ymd(new Date(y, +m[1] - 1, +m[2]));
    } else if ((m = take(/\b(?:until|through|thru|till|ending) (?:the end of )?(20\d\d)\b/))) r.until = `${m[1]}-12-31`;
    if ((m = take(/\b(\d+) times\b/))) r.count = Math.min(9999, +m[1]);
    return { repeat: r, hits };
  }

  // Pick the first due time for a parsed rule, given an optional parsed date/time.
  function firstDue(r, when, now = new Date()) {
    const h = when ? when.getHours() : 9, mi = when ? when.getMinutes() : 0;
    let d;
    if (r.freq === 'monthly' && r.day) {
      const at = k => { const dim = new Date(now.getFullYear(), now.getMonth() + k + 1, 0).getDate(); return new Date(now.getFullYear(), now.getMonth() + k, Math.min(r.day, dim), h, mi); };
      d = at(0); if (d <= now) d = at(1);
    } else if (r.freq === 'weekly' && r.days && r.days.length) {
      d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, mi);
      for (let i = 0; i < 8 && !(r.days.includes(d.getDay()) && d > now); i++) d.setDate(d.getDate() + 1);
    } else if (when) d = new Date(when);
    else { d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, mi); if (d <= now) d.setDate(d.getDate() + 1); }
    return d;
  }

  const R = { occs, list, nextAfter, advance, describe, parse, firstDue, valid, ymd, DAYS };
  if (typeof module !== 'undefined' && module.exports) module.exports = R; else g.Recur = R;
})(typeof self !== 'undefined' ? self : this);
