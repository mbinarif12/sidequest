// ---- Pure logic: dates, money, parsing, matching. No DOM. ----
const L = (() => {
  const pad = n => String(n).padStart(2, "0");
  const iso = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const parseISO = s => { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  const addDays = (s, n) => { const d = parseISO(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
  const weekday = s => parseISO(s).getUTCDay(); // 0 Sun..6 Sat
  const mondayOf = s => addDays(s, -((weekday(s) + 6) % 7));
  const dmyToISO = s => { const [d, m, y] = s.split("/"); return `${y}-${pad(+m)}-${pad(+d)}`; };
  const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
  const cents = n => Math.round(n * 100);
  const amountOf = l => l.kind === "cancelled" ? 0 : round2((+l.hours || 0) * (+l.rate || 0));
  const PAID_KINDS = ["class", "noshow", "demo", "meeting", "reports", "prep", "other"];

  // 15th of the month after a given date
  const fifteenthAfter = s => { const d = parseISO(s); return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 15))); };

  // ---- Weekly wages email ----
  // Rows look like: "<n> <Lesson(20)-18 | T0613> <code> <course…> <type> dd/mm/yyyy HH:MM dur hours rate subtotal <teacher>"
  function parseWeekly(raw) {
    const text = String(raw || "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
    let week = null;
    const wk = text.match(/Weekly wages of (\d{1,2})\s*-\s*(\d{1,2}) (\w{3})\w* (\d{4})/i);
    let body = text;
    const h = text.search(/Subtotal Teacher/i);
    if (h >= 0) body = text.slice(h + "Subtotal Teacher".length);
    let totalHours = null, totalAmount = null;
    const tm = body.match(/\bTotal\s+([\d.]+)\s+([\d.]+)/);
    if (tm) { totalHours = +tm[1]; totalAmount = +tm[2]; body = body.slice(0, tm.index); }
    const re = /(\d+)\s+(.+?)\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2}:\d{2})\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([A-Za-z][\w'-]*)/g;
    const lines = []; let m;
    while ((m = re.exec(body))) {
      const mid = m[2];
      const ctr = mid.match(/Lesson\((\d+)\)-(\d+)/i);
      const code = (mid.match(/\b(IE\d+|T\d{3,})\b/) || [])[1] || "";
      const type = (mid.match(/(Small Group|1v1 Class|Group Class|Trial class)\s*$/i) || [])[1] || "";
      lines.push({
        row: +m[1], label: mid.trim(), code,
        pkgSize: ctr ? +ctr[1] : null, counter: ctr ? +ctr[2] : null,
        type, trial: /trial/i.test(mid),
        date: dmyToISO(m[3]), time: m[4],
        duration: +m[5], hours: +m[6], rate: +m[7], subtotal: +m[8], teacher: m[9],
      });
    }
    if (wk) {
      const months = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
      const mo = months[wk[3].toLowerCase()];
      if (mo) week = { start: `${wk[4]}-${pad(mo)}-${pad(+wk[1])}`, end: `${wk[4]}-${pad(mo)}-${pad(+wk[2])}` };
    }
    if (!week && lines.length) {
      const first = lines.map(l => l.date).sort()[0];
      const s = mondayOf(first); week = { start: s, end: addDays(s, 6) };
    }
    return { week, lines, totalHours, totalAmount };
  }

  // Problems inside the statement itself (no log needed)
  function internalChecks(p) {
    const issues = [];
    const rows = p.lines.map(l => l.row).sort((a, b) => a - b);
    if (rows.length) {
      for (let r = 1; r <= rows[rows.length - 1]; r++)
        if (!rows.includes(r)) issues.push({ sev: "warn", text: `Row ${r} is missing from the numbering (rows run ${rows.join(", ")}).` });
    }
    const sumH = round2(p.lines.reduce((a, l) => a + l.hours, 0));
    const sumA = round2(p.lines.reduce((a, l) => a + l.subtotal, 0));
    if (p.totalHours != null && cents(p.totalHours) !== cents(sumH))
      issues.push({ sev: "warn", text: `Total line says ${p.totalHours} h, but the lines add up to ${sumH} h.` });
    if (p.totalAmount != null && cents(p.totalAmount) !== cents(sumA))
      issues.push({ sev: "bad", text: `Total line says €${p.totalAmount.toFixed(2)}, but the lines add up to €${sumA.toFixed(2)}.` });
    p.lines.forEach(l => {
      if (cents(round2(l.hours * l.rate)) !== cents(l.subtotal))
        issues.push({ sev: "bad", text: `Row ${l.row}: ${l.hours} h × €${l.rate} should be €${round2(l.hours * l.rate).toFixed(2)}, not €${l.subtotal.toFixed(2)}.` });
      if (l.duration !== l.hours)
        issues.push({ sev: "warn", text: `Row ${l.row}: lesson duration ${l.duration} h but paid hours ${l.hours} h.` });
    });
    return { issues, sumH, sumA };
  }

  // Match statement lines to logged lessons
  function matchStatement(p, students, lessons) {
    const inWeek = lessons.filter(l => l.date >= p.week.start && l.date <= p.week.end && PAID_KINDS.includes(l.kind));
    const used = new Set();
    // Who a line is for. A course code is exact; otherwise the name, and when two students share a name
    // (e.g. one person taking Maths and Applied Maths) every one of them is a candidate.
    const subjWord = t => /appl/i.test(t) ? "applied" : /math/i.test(t) ? "maths" : "";
    const candidatesFor = line => {
      // Course code first, then everyone with that name (same subject first): admin sometimes puts the wrong code on a line
      const byCode = line.code ? students.filter(s => s.code && s.code.toUpperCase() === line.code.toUpperCase()) : [];
      const lab = line.label.toLowerCase(), sw = subjWord(line.label);
      const byName = students.filter(s => s.name && new RegExp(`\\b${s.name.toLowerCase()}\\b`).test(lab) && !byCode.includes(s))
        .sort((a, b) => (subjWord(b.subject) === sw) - (subjWord(a.subject) === sw));
      return byCode.concat(byName);
    };
    const rows = p.lines.map(line => {
      const cands = candidatesFor(line);
      let lesson = null, st = cands[0] || null;
      for (const c of cands) {
        lesson = inWeek.find(l => !used.has(l.id) && l.studentId === c.id && l.date === line.date);
        if (lesson) { st = c; break; }
      }
      if (!lesson) // one-offs (trials, demos, meetings) logged without a student: same date and hours
        lesson = inWeek.find(l => !used.has(l.id) && !l.studentId && l.date === line.date && cents(l.hours) === cents(line.hours))
          || inWeek.find(l => !used.has(l.id) && !l.studentId && l.date === line.date);
      if (lesson) used.add(lesson.id);
      const diffs = [];
      if (lesson) {
        if (cents(lesson.hours) !== cents(line.hours)) diffs.push({ sev: "bad", text: `hours: you logged ${lesson.hours} h, admin paid ${line.hours} h` });
        if (cents(lesson.rate) !== cents(line.rate)) diffs.push({ sev: "bad", text: `rate: you logged €${lesson.rate}, admin used €${line.rate}` });
        if (cents(amountOf(lesson)) !== cents(line.subtotal) && !diffs.length) diffs.push({ sev: "bad", text: `amount: you logged €${amountOf(lesson).toFixed(2)}, admin paid €${line.subtotal.toFixed(2)}` });
        if (line.counter != null && lesson.number != null && lesson.number !== "" && +lesson.number !== line.counter)
          diffs.push({ sev: "info", text: `lesson count: your log says ${lesson.number}, admin says ${line.counter} of ${line.pkgSize}` });
      }
      const status = !lesson ? "extra" : diffs.some(d => d.sev === "bad") ? "diff" : diffs.length ? "note" : "ok";
      return { line, student: st, lesson, diffs, status };
    });
    // A double lesson logged as one (e.g. 2 h) can stand for several of admin's lines (two 1 h lessons)
    rows.filter(r => r.status === "extra").forEach(r => {
      const cands = candidatesFor(r.line).map(c => c.id);
      const host = rows.find(q => q.lesson && q !== r && q.lesson.date === r.line.date && cands.includes(q.lesson.studentId)
        && cents(q.lesson.hours) > cents((q.mergedHours || q.line.hours)) && cents((q.mergedHours || q.line.hours) + r.line.hours) <= cents(q.lesson.hours));
      if (!host) return;
      host.mergedHours = round2((host.mergedHours || host.line.hours) + r.line.hours);
      r.lesson = host.lesson; r.student = host.student; r.status = "ok"; r.diffs = []; r.mergedInto = host.line.row;
      if (cents(host.mergedHours) === cents(host.lesson.hours)) {
        const paid = rows.filter(x => x === host || x.mergedInto === host.line.row).reduce((a, x) => a + x.line.subtotal, 0);
        host.diffs = host.diffs.filter(d => !/^(hours|amount)/.test(d.text));
        if (cents(paid) !== cents(amountOf(host.lesson))) host.diffs.push({ sev: "bad", text: `amount: you logged €${amountOf(host.lesson).toFixed(2)}, admin paid €${paid.toFixed(2)} across ${rows.filter(x => x.mergedInto === host.line.row).length + 1} lines` });
        host.status = host.diffs.some(d => d.sev === "bad") ? "diff" : host.diffs.length ? "note" : "ok";
      }
    });
    const missing = inWeek.filter(l => !used.has(l.id) && amountOf(l) > 0);
    const owedPerLog = round2(inWeek.reduce((a, l) => a + amountOf(l), 0));
    return { rows, missing, owedPerLog };
  }

  // ---- Sage payslip text (best effort; the form is always reviewed) ----
  // Sage payslip text. Google's PDF conversion scrambles the column order, so this reads by arithmetic, not layout:
  // net = gross − total deductions. `hint` = the gross you expect (your logged lessons / admin's weekly emails).
  function parsePayslip(raw, hint) {
    const text = String(raw || "").replace(/ /g, " ");
    const out = {};
    const dm = text.match(/\b(\d{2}\/\d{2}\/\d{4})\b/); if (dm) out.payDate = dmyToISO(dm[1]);
    const nums = [], seen = {};
    (text.match(/-?\d{1,3}(?:,\d{3})*\.\d{2}\b|-?\d+\.\d{2}\b/g) || []).forEach(x => { const v = +x.replace(/,/g, ""); if (!seen[v]) { seen[v] = 1; nums.push(v); } });
    const C = cents, has = v => nums.some(n => C(n) === C(v));
    // 1) labelled values when the label sits next to its number
    const lab = re => { const m = text.match(re); return m ? +m[1].replace(/,/g, "") : null; };
    const salary = lab(/Salary\s+T?\s*(-?\d[\d,]*\.\d{2})/i);
    const grossLab = lab(/GROSS PAY\s+(\d[\d,]*\.\d{2})/i);
    const paye = lab(/PAYE\s+(-?\d[\d,]*\.\d{2})/i), usc = lab(/USC\s+(-?\d[\d,]*\.\d{2})/i), prsi = lab(/PRSI\s+(-?\d[\d,]*\.\d{2})/i);
    if (paye != null) out.paye = paye; if (usc != null) out.usc = usc;
    // 2) find gross G, deductions D, net N in the text with N = G − D (D is shown negative for tax taken, positive for a refund... Sage prints it signed)
    const triples = [];
    nums.forEach(G => { if (G <= 0) return; nums.forEach(D => { if (D === G || D === 0) return; const N = round2(G + D); if (N > 0 && N !== G && has(N)) triples.push({ G, D, N }); const N2 = round2(G - D); if (N2 > 0 && N2 !== G && N2 !== N && has(N2)) triples.push({ G, D: -D, N: N2 }); }); });
    const score = t => (hint != null && C(t.G) === C(hint) ? 100 : 0) + (salary != null && C(t.G) === C(salary) ? 50 : 0) + (grossLab != null && C(t.G) === C(grossLab) ? 45 : 0)
      + (paye != null || usc != null ? (C((paye || 0) + (usc || 0) + (prsi || 0)) === C(t.D) ? 40 : 0) : 0) + (t.N > t.G * 0.3 ? 5 : 0);
    triples.sort((a, b) => score(b) - score(a));
    const best = triples[0];
    if (best && score(best) >= 40) { out.gross = best.G; out.net = best.N; out.deductions = best.D; }
    else if (salary != null) { out.gross = salary; if (!nums.some(n => n !== salary && n < 0)) out.net = salary; } // no deductions at all
    else if (hint != null && has(hint)) { out.gross = hint; }
    // 3) year-to-date gross: "CUMULATIVE ... GROSS PAY 3010.25", else the largest number ≥ gross that isn't a tax threshold
    const cum = text.match(/CUMULATIVE[\s\S]{0,400}?GROSS PAY\s+(\d[\d,]*\.\d{2})/i);
    if (cum) out.cumulativeGross = +cum[1].replace(/,/g, "");
    else { const c2 = text.match(/CUMULATIVE[\s\S]{0,200}?(\d[\d,]*\.\d{2})/i); if (c2 && out.gross != null && +c2[1].replace(/,/g, "") >= out.gross) out.cumulativeGross = +c2[1].replace(/,/g, ""); }
    const per = text.match(/PAY PERIOD\s+(\d{1,2})\b/i); if (per) out.period = +per[1];
    out.nums = nums;
    return out;
  }

  // "…wages from 31 August to 27 September 2026" → {start, end}
  function parsePeriod(raw, fallbackYear) {
    const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
    // "from 31 August to 27 September 2026", and also "from 25 May to 28 June" (no year: use the email's year)
    const m = String(raw || "").replace(/\s+/g, " ").match(/from (\d{1,2}) ([A-Za-z]+)(?: (\d{4}))? to (\d{1,2}) ([A-Za-z]+)(?: (\d{4}))?/i);
    if (!m) return null;
    const mi = s => months.findIndex(x => x.startsWith(s.toLowerCase().slice(0, 3))) + 1;
    const m1 = mi(m[2]), m2 = mi(m[5]); if (!m1 || !m2) return null;
    const y2 = m[6] ? +m[6] : fallbackYear; if (!y2) return null;
    const y1 = m[3] ? +m[3] : (m1 > m2 ? y2 - 1 : y2);
    return { start: `${y1}-${pad(m1)}-${pad(+m[1])}`, end: `${y2}-${pad(m2)}-${pad(+m[4])}` };
  }


  // ---- Pay periods (monthly, paid around the 15th of the next month) ----
  // Whole Mon–Sun weeks; a week belongs to the month its Sunday falls in.
  // So a period runs from the day after the previous month's last Sunday to this month's last Sunday (4 or 5 weeks).
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const lastSunday = (y, m) => { const d = new Date(Date.UTC(y, m + 1, 0)); d.setUTCDate(d.getUTCDate() - d.getUTCDay()); return iso(d); }; // m 0-based
  function periodOfMonth(y, m) {
    const pm = m === 0 ? [y - 1, 11] : [y, m - 1];
    const start = addDays(lastSunday(pm[0], pm[1]), 1), end = lastSunday(y, m);
    return { key: `${y}-${pad(m + 1)}`, name: MONTHS[m], year: y, start, end, weeks: Math.round((parseISO(end) - parseISO(start)) / 864e5 + 1) / 7, due: iso(new Date(Date.UTC(y, m + 1, 15))) };
  }
  function periodFor(dateISO) {
    const sun = addDays(dateISO, (7 - weekday(dateISO)) % 7), d = parseISO(sun);
    return periodOfMonth(d.getUTCFullYear(), d.getUTCMonth());
  }
  // The real periods: a payslip's own dates win (e.g. an odd 5-week period), the last-Sunday rule fills the rest.
  function buildPeriods(firstDate, today, slips) {
    const dated = (slips || []).filter(s => s.periodEnd).sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
    const out = [], keys = {};
    let start = periodFor(firstDate || today).start;
    const s0 = dated.find(s => s.periodStart && s.periodStart <= (firstDate || today) && s.periodEnd >= (firstDate || today));
    if (s0 && s0.periodStart < start) start = s0.periodStart;
    while (start <= today && out.length < 120) {
      const slip = dated.find(s => s.periodEnd >= start && s.periodEnd <= addDays(start, 45) && (!s.periodStart || s.periodStart <= addDays(start, 6)));
      const end = slip ? slip.periodEnd : periodFor(start).end;
      // Named after the month most of it falls in (28 Sep – 1 Nov is "October")
      const span = Math.round((parseISO(end) - parseISO(start)) / 864e5), d = parseISO(addDays(start, Math.floor(span / 2)));
      let key = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
      if (keys[key]) key += "b"; keys[key] = 1;
      out.push({ key, name: MONTHS[d.getUTCMonth()], year: d.getUTCFullYear(), start, end, weeks: Math.round((parseISO(end) - parseISO(start)) / 864e5 + 1) / 7, due: fifteenthAfter(end), slip: slip || null, fromSlip: !!slip });
      start = addDays(end, 1);
    }
    return out;
  }
  const periodName = (start, end) => { if (!start) return periodFor(end).name; const span = Math.round((parseISO(end) - parseISO(start)) / 864e5); return MONTHS[parseISO(addDays(start, Math.floor(span / 2))).getUTCMonth()]; };
  const nextPeriod = p => p.key.endsWith("-12") ? periodOfMonth(p.year + 1, 0) : periodOfMonth(p.year, +p.key.slice(5) );

  // Problems that change what you're paid. Email cosmetics and lesson counters are left out on purpose.
  function moneyIssues(p, students, lessons) {
    const out = [], ic = internalChecks(p), m = matchStatement(p, students, lessons);
    ic.issues.filter(i => i.sev === "bad").forEach(i => out.push({ text: i.text }));
    m.rows.forEach(r => {
      const who = (r.student && r.student.name) || r.line.label.replace(/Lesson\(\d+\)-\d+\s*/, "").replace(/\b(IE\d+|T\d+)\b/, "").trim().slice(0, 40);
      if (r.status === "extra") out.push({ date: r.line.date, text: `Admin paid ${who} (€${r.line.subtotal.toFixed(2)}, ${r.line.hours} h × €${r.line.rate}${r.line.code ? ", code " + r.line.code : ""}) but it isn't in your lessons`, amount: r.line.subtotal, line: r.line, studentId: r.student ? r.student.id : "" });
      r.diffs.filter(d => d.sev === "bad").forEach(d => out.push({ date: r.line.date, text: `${who}: ${d.text}` }));
    });
    const nm = l => ((students.find(s => s.id === l.studentId) || {}).name) || l.label || "A lesson";
    m.missing.forEach(l => out.push({ date: l.date, lessonId: l.id, text: `${nm(l)} isn't on admin's list (€${amountOf(l).toFixed(2)})`, amount: -amountOf(l) }));
    return out;
  }

  return { iso, parseISO, addDays, weekday, mondayOf, dmyToISO, round2, cents, amountOf, fifteenthAfter, parseWeekly, internalChecks, matchStatement, parsePayslip, parsePeriod, periodFor, periodOfMonth, nextPeriod, buildPeriods, periodName, moneyIssues, PAID_KINDS, MONTHS };
})();
if (typeof module !== "undefined") module.exports = L;
