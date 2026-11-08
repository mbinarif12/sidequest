// ---- SideQuest web page: Home, Lessons, Payslips, Payment claim, Profile ----
const S = { students: [], lessons: [], statements: [], payslips: [], todos: [] };
const COLS = Object.keys(S);
let STATUS = {}, searchPoll = null, searchWasRunning = false;
// While the background payslip search runs, check every 20 s and say when it's done
function watchSearch() {
  const running = /^running/.test(STATUS.oldSearch || "");
  if (running && !searchPoll) searchPoll = setInterval(async () => { try { applyAll(await gs("api_getAll")); } catch (e) {} }, 20000);
  if (!running && searchPoll) { clearInterval(searchPoll); searchPoll = null; }
  if (searchWasRunning && !running) {
    if (/^error/.test(STATUS.oldSearch)) toast("The payslip search stopped: " + STATUS.oldSearch.split("|").slice(2).join("|"), 10000);
    else { let r = {}; try { r = JSON.parse(STATUS.oldSearchResult || "{}"); } catch (e) {} toast(r.found ? `Payslip search done. Found ${r.found} payslip PDF${r.found > 1 ? "s" : ""}.${r.months && r.months.length ? " Added: " + r.months.join(", ") + "." : ""}${r.already && r.already.length ? " Already had: " + r.already.join(", ") + "." : ""}` : "Payslip search done: no payslip PDFs found in this Gmail account.", 12000); }
  }
  searchWasRunning = running;
}
let CAL = { planned: [], unmatched: [], orphans: [], error: "", created: 0 }, TODAY = "", lastRun = "", loaded = false, loadErr = "", PROFILE = {}, RATES = [], NOW = null;
let view = "home", weekStart = "", sel = null, selPeriod = null;
const KINDS = { class: "Taught", noshow: "No-show", cancelled: "Cancelled", demo: "Demo / trial", meeting: "Meeting", reports: "Student reports", prep: "Lesson prep", other: "Other work" };
const OTHER_KINDS = ["meeting", "reports", "prep", "demo", "other"];

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const eur = n => "€" + (+n || 0).toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hrs = n => `${+(+n || 0).toFixed(2)} h`;
const fmtD = (s, o = { day: "numeric", month: "short" }) => s ? L.parseISO(s).toLocaleDateString("en-IE", { timeZone: "UTC", ...o }) : "";
const dow = s => fmtD(s, { weekday: "short" }).toUpperCase();
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const stu = id => S.students.find(s => s.id === id);
const nameOf = l => l.studentId ? (stu(l.studentId)?.name || "Unknown") : (l.label || KINDS[l.kind] || "Other work");
const subjOf = l => l.studentId ? (stu(l.studentId)?.subject || "").replace(/\s*\(H\)/, "") : KINDS[l.kind];
const strip = o => { const { id, ...r } = o; return r; };
const sum = (a, f) => L.round2(a.reduce((x, y) => x + f(y), 0));
const paidLessons = ls => ls.filter(l => l.kind !== "cancelled");

// ---- Store: the Google Sheet through google.script.run ----
const gs = (fn, ...a) => new Promise((res, rej) => google.script.run.withSuccessHandler(res).withFailureHandler(rej)[fn](...a));
function applyAll(d) {
  COLS.forEach(c => S[c] = d[c] || []); CAL = { orphans: [], ...(d.calendar || CAL) }; TODAY = d.today || TODAY; lastRun = d.lastRun || ""; PROFILE = d.profile || PROFILE; RATES = d.rates || RATES; STATUS = d.status || STATUS; watchSearch(); NOW = d.now ? new Date(d.now) : new Date();
  if (!weekStart) weekStart = L.mondayOf(TODAY);
  loaded = true; loadErr = ""; render();
  if (CAL.created) toast(`${CAL.created} class${CAL.created > 1 ? "es" : ""} logged from your calendar.`);
}
async function load() { try { applyAll(await gs("api_getAll")); } catch (e) { loadErr = e.message || String(e); render(); } }
async function save(col, id, data) {
  const a = S[col], i = a.findIndex(x => x.id === id), doc = { ...data, id };
  i >= 0 ? a.splice(i, 1, doc) : a.push(doc); render();
  try { await gs("api_save", col, id, data); } catch (e) { toast("Couldn't save: " + (e.message || e)); load(); }
}
async function remove(col, id) {
  S[col] = S[col].filter(x => x.id !== id); render();
  try { await gs("api_remove", col, id); } catch (e) { toast("Couldn't delete: " + (e.message || e)); load(); }
}

// ---- Text boxes grow as you type ----
function grow(t) { t.style.height = "auto"; t.style.height = (t.scrollHeight + 2) + "px"; }
function growAll(root) { (root || document).querySelectorAll("textarea").forEach(grow); }
document.addEventListener("input", e => { if (e.target.tagName === "TEXTAREA") grow(e.target); });
// ---- Theme: light unless you pick dark (or "match my computer") in Profile ----
function applyTheme() {
  const t = PROFILE.theme || "light";
  const dark = t === "dark" || (t === "system" && window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

// ---- Rates and time ----
function rateFor(kind, date, sid) {
  const s = stu(sid); if (s && s.ownRate) return +s.ownRate;
  const r = RATES.filter(x => x.from <= date).sort((a, b) => a.from.localeCompare(b.from)).pop() || { class: 35, trial: 35, other: 20 };
  return kind === "demo" ? r.trial : ["meeting", "reports", "prep", "other"].includes(kind) ? r.other : r.class;
}
const nowMs = () => Date.now(); // the viewer's clock
const startMs = p => p.start ? Date.parse(p.start) : Date.parse(p.date + "T" + (p.time || "00:00") + ":00");
const hasStarted = p => startMs(p) <= nowMs();
const booked = sid => CAL.error ? 0 : CAL.planned.filter(p => p.studentId === sid && !p.lessonId).length;

// ---- Derived data ----
function lessonsDone(s) {
  const ls = S.lessons.filter(l => l.studentId === s.id && l.kind === "class").sort((a, b) => a.date.localeCompare(b.date));
  let i = ls.length - 1; while (i >= 0 && !(+ls[i].number > 0)) i--;
  return i >= 0 ? +ls[i].number + (ls.length - 1 - i) : (+s.priorCount || 0) + ls.length;
}
function nextNumber(sid) { const s = stu(sid); if (!s) return null; const d = lessonsDone(s); return s.pkgSize && d >= s.pkgSize ? 1 : d + 1; }
const inRange = (a, b) => S.lessons.filter(l => l.date >= a && l.date <= b);
const stmtTotal = st => sum(st.lines || [], l => l.subtotal);

function periods() {
  if (!TODAY) return [];
  const first = S.lessons.map(l => l.date).sort()[0] || TODAY;
  return L.buildPeriods(first, TODAY, S.payslips).map(p => {
    const ls = paidLessons(inRange(p.start, p.end));
    const stmts = S.statements.filter(s => s.week && s.week.start >= p.start && s.week.start <= p.end);
    const status = p.slip && p.slip.receivedDate ? "paid" : p.slip ? "slip" : p.end < TODAY ? "due" : "open";
    return { ...p, lessons: ls, logged: sum(ls, L.amountOf), hours: sum(ls, l => +l.hours || 0), stmts, confirmed: sum(stmts, stmtTotal), status };
  });
}
function issues() {
  const out = [];
  S.statements.filter(s => !s.resolved && s.week).sort((a, b) => b.week.start.localeCompare(a.week.start)).forEach(st => {
    const list = L.moneyIssues({ week: st.week, lines: st.lines || [], totalHours: st.totalHours, totalAmount: st.totalAmount }, S.students, S.lessons);
    if (list.length) out.push({ key: st.id, stmt: st, title: `Week of ${fmtD(st.week.start)} – ${fmtD(st.week.end)}`, list });
  });
  periods().forEach(p => {
    if (p.slip && p.slip.gross != null && p.lessons.length && L.cents(p.slip.gross) !== L.cents(p.logged) && !p.slip.mismatchOk)
      out.push({ key: p.slip.id, slipId: p.slip.id, title: `${p.name} payslip`, list: [{ text: `Payslip says ${eur(p.slip.gross)}, your lessons add up to ${eur(p.logged)} (${p.slip.gross < p.logged ? eur(p.logged - p.slip.gross) + " short" : eur(p.slip.gross - p.logged) + " more"})` }] });
  });
  return out;
}
function calSlotsForWeek(ws) {
  // Planned lessons for the week: calendar events, or each student's weekly slot if the calendar isn't readable.
  const we = L.addDays(ws, 6), items = [];
  if (!CAL.error) {
    CAL.planned.filter(p => p.date >= ws && p.date <= we && !p.lessonId).forEach(p => items.push({ planned: true, ...p }));
  } else {
    S.students.filter(s => s.active && s.weekday != null && s.weekday !== "").forEach(s => {
      const d = L.addDays(ws, (s.weekday + 6) % 7);
      if (d < TODAY || S.lessons.some(l => l.studentId === s.id && l.date === d)) return;
      items.push({ planned: true, eventId: "slot-" + s.id + d, studentId: s.id, date: d, time: s.time || "", hours: s.hours });
    });
  }
  return items;
}
function upcoming(n) {
  const ws = L.mondayOf(TODAY);
  return [...calSlotsForWeek(ws), ...calSlotsForWeek(L.addDays(ws, 7))].filter(p => p.date >= TODAY)
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).slice(0, n);
}
// ---- Packages: when does each student's current package end? ----
function packageInfo(s) {
  if (!s.pkgSize) return null;
  const ls = S.lessons.filter(l => l.studentId === s.id && l.kind === "class").sort((a, b) => a.date.localeCompare(b.date));
  let i = ls.length - 1; while (i >= 0 && +ls[i].number !== 1) i--;
  const startedOn = i >= 0 ? ls[i].date : (ls[0] ? ls[0].date : "start");
  const left = s.pkgSize - lessonsDone(s);
  const upcomingCls = CAL.error ? [] : CAL.planned.filter(p => p.studentId === s.id && !p.lessonId).sort((a, b) => a.start.localeCompare(b.start));
  const last = left > 0 ? upcomingCls[left - 1] : null; // the booked class that will be the package's last
  return { left, startedOn, lastDate: last ? last.date : "", key: `${s.id}-${startedOn}` };
}
function packageAlerts() {
  return S.students.filter(s => s.active && s.pkgSize).map(s => ({ s, p: packageInfo(s) }))
    .filter(x => x.p && x.p.left >= 0 && (x.p.lastDate ? x.p.lastDate <= L.addDays(TODAY, 7) : x.p.left <= 1));
}
// Package ending soon → two real, tickable to-dos (created once per package)
let pkgSyncing = false; const pkgMade = new Set(); // never create the same reminder twice, even before the Sheet answers
async function ensurePackageTodos() {
  if (pkgSyncing || !loaded) return; pkgSyncing = true;
  for (const { s, p } of packageAlerts()) {
    const when = p.lastDate ? `last class ${fmtD(p.lastDate, { weekday: "short", day: "numeric", month: "short" })}` : p.left ? "1 lesson left" : "package finished";
    for (const [k, text] of [["exam", `Prepare an exam for ${s.name} (${s.subject.replace(/\s*\(H\)/, "")})`], ["report", `Write ${s.name}'s student report`]]) {
      const key = `${k}-${p.key}`;
      if (pkgMade.has(key) || S.todos.some(t => t.key === key)) continue;
      pkgMade.add(key); await save("todos", "auto-" + uid(), { text: `${text} · ${when}`, done: false, createdAt: new Date().toISOString(), key });
    }
  }
  pkgSyncing = false;
}
function todos() {
  const out = [];
  CAL.orphans.forEach(id => { const l = S.lessons.find(x => x.id === id); if (l) out.push({ id: "or-" + id, act: "open", lid: id, title: `${nameOf(l)}'s ${fmtD(l.date)} class is no longer in your calendar`, sub: "Was it cancelled or moved?", warn: true }); });
  const seenTodo = new Set();
  S.todos.filter(t => !t.done).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).forEach(t => {
    const k = t.key || t.text.trim().toLowerCase(); if (seenTodo.has(k)) return; seenTodo.add(k); // each to-do shows once
    out.push({ id: "my-" + t.id, act: "mine", tid: t.id, title: t.text, sub: t.key ? "Package ending" : "Your to-do" });
  });
  S.lessons.filter(l => l.followups && !l.followupsDone).sort((a, b) => b.date.localeCompare(a.date))
    .forEach(l => out.push({ id: "fu-" + l.id, act: "fudone", lid: l.id, title: l.followups.split("\n")[0], sub: `${nameOf(l)} · ${fmtD(l.date)}` }));
  S.lessons.filter(l => l.kind === "class" && l.date <= TODAY && l.date >= L.addDays(TODAY, -21) && !l.topic && !l.notes)
    .forEach(l => out.push({ id: "nt-" + l.id, act: "open", lid: l.id, title: `Write notes for ${nameOf(l)}'s lesson`, sub: `${fmtD(l.date, { weekday: "short", day: "numeric", month: "short" })}${l.number ? " · lesson " + l.number : ""}` }));
  S.payslips.filter(p => p.needsCheck && p.pdfUrl && p.periodEnd).forEach(p => out.push({ id: "ps-" + p.id, act: "slip", pid: p.id, title: `Type in the ${L.periodName(p.periodStart, p.periodEnd)} payslip's amounts`, sub: "Payslips page · its PDF couldn't be read" }));
  return out;
}

// ---- Render ----
function render() {
  document.querySelectorAll("nav button").forEach(b => b.setAttribute("aria-current", b.dataset.v === view ? "page" : "false"));
  const av = $("#me"); if (av) { av.innerHTML = avatar(); av.title = PROFILE.teacherName || "Profile"; }
  $("#sync").innerHTML = CAL.error ? `<span class="warn-t">Calendar not connected</span>` : loaded ? `${ICON.cal}<span class="sr">Calendar connected</span>` : "";
  $("#sync").title = CAL.error || (lastRun ? "Emails last checked " + new Date(lastRun).toLocaleString("en-IE") : "");
  const main = $("#main");
  if (loadErr) { main.innerHTML = `<div class="card empty">SideQuest couldn't read your Sheet. ${esc(loadErr)}<br><button class="btn" data-act="reload">Try again</button></div>`; return; }
  if (!loaded) { main.innerHTML = `<div class="loading"><div class="sk big"></div><div class="sk"></div><div class="sk"></div></div>`; return; }
  main.innerHTML = ({ home: vHome, lessons: vLessons, students: vStudents, payslips: vPayslips, claim: vClaim, profile: vProfile })[view]();
  applyTheme(); growAll(main);
  if (loaded) setTimeout(ensurePackageTodos, 0);
}
const ICON = {
  cal: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/></svg>`,
  ok: `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M8 12.5l2.5 2.5L16 9.5"/></svg>`,
  alert: `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/></svg>`,
};
ICON.lock = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`;
const avatar = () => PROFILE.photo ? `<img src="${esc(PROFILE.photo)}" alt="">` : `<span>${esc((PROFILE.teacherName || "?").split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase())}</span>`;
const line2 = (k, v) => `<div class="kv"><span>${k}</span><span>${v}</span></div>`;
const pill = (cls, t) => `<span class="pill ${cls}">${esc(t)}</span>`;
const PSTAT = p => p.status === "paid" ? ["ok", "Paid " + fmtD(p.slip.receivedDate)] : p.status === "slip" ? ["due", "Payslip in · due " + fmtD(p.due)] : p.status === "due" ? ["due", "Due " + fmtD(p.due)] : ["open", "In progress"];

function welcome() {
  return `<section class="card welcome"><span class="eyebrow">Welcome to SideQuest</span><h1>Let's set up your side gig</h1>
    <ol>
      <li><b>Add your students</b> with their subject, course code and package size. <button class="link" data-act="newstu">Add a student</button></li>
      <li><b>Set your rates</b> and the address your wages emails come from. <button class="link" data-act="nav" data-v="profile">Open Profile</button></li>
      <li><b>Keep your classes in Google Calendar.</b> Any event with a student's name or course code becomes a class. <button class="link" data-act="sync">Sync calendar</button></li>
    </ol>
    <p class="muted small">Your data lives in your own Google Sheet. Nothing is shared.</p></section>`;
}
function vHome() {
  if (!S.students.length && !S.lessons.length) return welcome();
  const ps = periods(), iss = issues(), nIss = iss.reduce((a, g) => a + g.list.length, 0);
  const due = ps.filter(p => p.status === "slip" || p.status === "due");
  const next = due[0] || ps[ps.length - 1];
  const after = next ? ps.find(p => p.key > next.key) : null;
  let hero = "";
  if (next) {
    const amt = next.slip && next.slip.gross != null ? next.slip.gross : next.logged;
    const wk = Math.round(next.weeks);
    const chip = next.status === "open" ? pill("dark", "In progress")
      : next.stmts.length < wk ? pill("dark", `Admin's emails: ${next.stmts.length} of ${wk} weeks`)
      : L.cents(next.confirmed) === L.cents(next.logged) ? pill("good", "Admin agrees") : pill("warn", "Doesn't match admin");
    hero = `<div class="hero">
      <div class="row-b"><span class="eyebrow on-dark">${next.status === "open" ? "This pay period" : "Next payment"}</span>${chip}</div>
      <div class="hero-amt">${eur(amt)}</div>
      <div class="hero-sub">${next.status === "open" ? "So far · paid by " : "Expected by "}<b>${fmtD(next.due, { weekday: "long", day: "numeric", month: "long" })}</b></div>
      <div class="hero-facts">
        <div>Covers<br><b>${fmtD(next.start)} – ${fmtD(next.end)}</b></div>
        <div>Work<br><b>${next.lessons.length} item${next.lessons.length === 1 ? "" : "s"} · ${hrs(next.hours)}</b></div>
        <div>Weekly emails<br><b>${next.stmts.length} of ${wk} received</b></div>
      </div></div>`;
  }
  const side = `<div class="side">
    ${after ? `<div class="card tight"><span class="eyebrow">After that</span><div class="amt2">${eur(after.logged)}</div><div class="muted small">So far for ${fmtD(after.start)} – ${fmtD(after.end)} (${Math.round(after.weeks)} weeks) · due by ${fmtD(after.due)}</div></div>` : ""}
    <button class="card status ${nIss ? "bad" : "good"}" data-act="issues" ${nIss ? "" : "disabled"}>
      <span class="ico">${nIss ? ICON.alert : ICON.ok}</span>
      <span class="grow"><b>${nIss ? `${nIss} pay problem${nIss > 1 ? "s" : ""}` : "No pay problems"}</b><br><span class="muted small">${nIss ? "Tap to see what doesn't match" : "Every lesson matches admin's emails"}</span></span>
    </button></div>`;
  const earned = sum(ps, p => p.logged), paid = sum(ps.filter(p => p.status === "paid"), p => p.slip.gross ?? p.logged);
  const strip = ps.slice(-6).map(p => {
    const [c, t] = PSTAT(p), amt = p.slip && p.slip.gross != null ? p.slip.gross : p.logged;
    return `<button class="per ${p.status}" data-act="period" data-k="${p.key}"><span class="b">${p.name}</span><span class="amt3">${eur(amt)}</span><span class="st ${c}">${p.status === "paid" ? "Paid " + fmtD(p.slip.receivedDate) : p.status === "open" ? "In progress" : "Due " + fmtD(p.due)}</span></button>`;
  }).join("");
  const up = upcoming(4), allTd = todos(), td = allTd.slice(0, 8);
  return `<section class="split2">${hero}${side}</section>
  <section class="card"><div class="row-b"><h2>Pay periods</h2><div class="muted small">Earned ${eur(earned)} · Paid ${eur(paid)} · <b class="ink">Owed ${eur(earned - paid)}</b></div></div>
    <div class="periods">${strip}</div></section>
  <section class="split3">
    <div class="card"><div class="row-b"><h2>Coming up</h2><button class="link" data-act="nav" data-v="lessons">Open calendar</button></div>
      ${up.length ? up.map(p => { const s = stu(p.studentId); return `<div class="li"><div class="date"><span>${dow(p.date)}</span><b>${+p.date.slice(8)}</b></div><div class="grow"><b>${esc(s?.name)} · ${esc((s?.subject || "").replace(/\s*\(H\)/, ""))}</b><div class="muted small">${esc(p.time)} · ${hrs(p.hours)}${nextNumber(p.studentId) && s?.pkgSize ? ` · lesson ${nextNumber(p.studentId)} of ${s.pkgSize}` : ""}</div></div><div class="num b">${eur(L.round2(p.hours * rateFor("class", p.date, p.studentId)))}</div></div>`; }).join("")
        : `<p class="empty">${CAL.error ? "Connect your calendar to see upcoming lessons." : "Nothing in your calendar for the next two weeks."}</p>`}</div>
    <div class="card"><div class="row-b"><h2>To do</h2>${allTd.length > td.length ? `<span class="muted small">${allTd.length - td.length} more</span>` : ""}</div>
      <form class="addtodo" data-form="todo"><label for="newtodo" class="sr">New to-do</label><textarea id="newtodo" rows="1" placeholder="Add your own to-do, e.g. Make an exam for Sadhbh"></textarea><button class="btn" type="submit">Add</button></form>
      ${td.length ? td.map(t => `<div class="li">${t.act === "fudone" || t.act === "mine" ? `<input type="checkbox" aria-label="Done" data-act="${t.act === "mine" ? "minedone" : "fudone"}" data-lid="${esc(t.lid || "")}" data-tid="${esc(t.tid || "")}">` : `<span class="dot ${t.warn ? "warn" : ""}" aria-hidden="true"></span>`}<button class="todo grow" data-act="todo" data-t="${esc(t.act)}" data-lid="${esc(t.lid || "")}" data-sid="${esc(t.sid || "")}" data-pid="${esc(t.pid || "")}"><b>${esc(t.title)}</b><br><span class="muted small">${esc(t.sub)}</span></button></div>`).join("")
        : `<p class="empty">All done.</p>`}
      <p class="muted small">Comes from your own to-dos, your notes' "To do after class", classes still missing notes, and exam + report reminders when a package is ending.</p></div>
  </section>`;
}

// ---- Lessons: a calendar week like Google Calendar ----
const WEEKS = {}; // monday → {events, error, loading}
const HOUR_PX = 52;
// One colour per subject (Maths blue, Applied Maths green, others after that), the same everywhere
const COLORS = ["c1", "c3", "c2", "c4", "c5", "c6"];
const subjectKey = sub => String(sub || "").toLowerCase().replace(/\(h\)|\(o\)|\bg\d+\b|\b1v1\b|leaving cert|junior cycle/g, "").replace(/\bmath\b/g, "maths").replace(/\s+/g, " ").trim() || "other";
const subjectName = sub => subjectKey(sub).replace(/\b\w/g, c => c.toUpperCase());
function subjectColor(sub) {
  const k = subjectKey(sub);
  if (k === "maths") return "c1"; if (k.includes("applied")) return "c3";
  const others = [...new Set(S.students.map(s => subjectKey(s.subject)).filter(x => x !== "maths" && !x.includes("applied")))].sort();
  return COLORS[2 + (Math.max(0, others.indexOf(k)) % 4)];
}
const colorOf = sid => subjectColor(stu(sid)?.subject);
const toMin = t => { const [h, m] = String(t || "0:0").split(":").map(Number); return h * 60 + (m || 0); };
const fromMin = m => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
async function loadWeek(ws, force) {
  if (WEEKS[ws] && !force && !WEEKS[ws].error) return;
  WEEKS[ws] = { events: (WEEKS[ws] || {}).events || [], loading: true };
  try { const r = await gs("api_week", ws); WEEKS[ws] = { events: r.events || [], error: r.error || "" }; }
  catch (e) { WEEKS[ws] = { events: [], error: e.message || String(e) }; }
  if (view === "lessons" && weekStart === ws) render();
}
// Everything to draw this week: classes (from calendar and/or your log), other calendar events greyed out
function weekBlocks(ws) {
  const we = L.addDays(ws, 6), W = WEEKS[ws] || { events: [] }, used = new Set(), blocks = [], allDay = [];
  const lessons = inRange(ws, we);
  W.events.forEach(ev => {
    if (ev.date < ws || ev.date > we) return;
    if (ev.allDay) { allDay.push({ other: true, date: ev.date, title: ev.title }); return; }
    const end = ev.endDate > ev.date ? "23:59" : ev.end;
    if (!ev.studentId) { blocks.push({ other: true, date: ev.date, start: ev.start, end, title: ev.title }); return; }
    const l = lessons.find(x => !used.has(x.id) && x.eventId === ev.key) || lessons.find(x => !used.has(x.id) && x.studentId === ev.studentId && x.date === ev.date);
    if (l) used.add(l.id);
    blocks.push({ date: ev.date, start: ev.start, end, studentId: ev.studentId, lesson: l, planned: l ? null : { eventId: ev.key, studentId: ev.studentId, date: ev.date, time: ev.start, hours: Math.round((toMin(end) - toMin(ev.start)) / 15) / 4, start: ev.startIso } });
  });
  // Classes in your log with no calendar event (e.g. older ones): at their time if known, else in the top row
  lessons.filter(l => !used.has(l.id)).forEach(l => {
    if (l.time) blocks.push({ date: l.date, start: l.time, end: fromMin(Math.min(1439, toMin(l.time) + Math.round((+l.hours || 1) * 60))), studentId: l.studentId, lesson: l });
    else allDay.push({ date: l.date, lesson: l });
  });
  // Calendar not readable: fall back to each student's usual slot
  if (W.error) calSlotsForWeek(ws).forEach(p => { if (!blocks.some(b => b.studentId === p.studentId && b.date === p.date)) blocks.push({ date: p.date, start: p.time || "09:00", end: fromMin(toMin(p.time || "09:00") + Math.round(p.hours * 60)), studentId: p.studentId, planned: p }); });
  return { blocks, allDay };
}
// Side-by-side columns for overlapping events, like Google Calendar
function layoutDay(bs) {
  bs.sort((a, b) => toMin(a.start) - toMin(b.start) || toMin(b.end) - toMin(a.end));
  let group = [], groupEnd = -1;
  const flush = () => { const cols = []; group.forEach(b => { let c = cols.findIndex(e => e <= toMin(b.start)); if (c < 0) { c = cols.length; cols.push(0); } cols[c] = toMin(b.end); b.col = c; }); group.forEach(b => b.ncol = cols.length); group = []; };
  bs.forEach(b => { if (toMin(b.start) >= groupEnd && group.length) { flush(); groupEnd = -1; } group.push(b); groupEnd = Math.max(groupEnd, toMin(b.end)); });
  if (group.length) flush();
  return bs;
}
function blockHtml(b, h0) {
  const top = (toMin(b.start) - h0 * 60) / 60 * HOUR_PX, ht = Math.max(22, (toMin(b.end) - toMin(b.start)) / 60 * HOUR_PX - 3);
  const pos = `top:${top}px;height:${ht}px;left:calc(${(b.col / b.ncol) * 100}% + 2px);width:calc(${100 / b.ncol}% - 6px)`;
  const tm = `${b.start}–${b.end === "23:59" ? "" : b.end}`;
  if (b.other) return `<div class="ev other" style="${pos}" title="${esc(b.title)}"><b>${esc(b.title)}</b><span>${tm}</span></div>`;
  const s = stu(b.studentId), l = b.lesson;
  const subj = esc((s?.subject || "").replace(/\s*\(H\)/, ""));
  let state = "plan", note = "Coming up";
  if (l) { state = l.kind === "cancelled" ? "cx" : (l.topic || l.notes || l.source === "history") ? "done" : "need"; note = l.kind === "cancelled" ? "Cancelled" : l.kind === "noshow" ? "✓ No-show" : state === "need" ? "✎ Add notes" : "✓ Done"; }
  else if (hasStarted(b.planned)) { state = "need"; note = "✎ Add notes"; }
  const act = l ? `data-act="pick" data-lid="${l.id}"` : `data-act="pickplan" data-eid="${esc(b.planned.eventId)}"`;
  return `<button class="ev ${colorOf(b.studentId)} ${state}" style="${pos}" ${act}><b>${esc(s?.name || "?")} · ${subj}</b><span>${tm}${note ? " · " + note : ""}</span></button>`;
}
function studentsCard() {
  return `<section class="card"><div class="row-b"><h2>Students</h2><button class="btn" data-act="newstu">Add student</button></div>
    <div class="studs">${S.students.filter(s => s.active).map(s => {
      const d = lessonsDone(s), left = s.pkgSize ? s.pkgSize - d : null, pct = s.pkgSize ? Math.min(100, Math.round(d / s.pkgSize * 100)) : 0;
      return `<button class="stud" data-act="student" data-sid="${s.id}"><span class="row-b"><b>${esc(s.name)}</b>${left != null ? `<span class="small ${left <= 2 ? "due-t" : "muted"} b">${left > 0 ? left + " left" : "finished"}</span>` : ""}</span>
        <span class="bar"><i class="${left != null && left <= 2 ? "low" : ""}" style="width:${pct}%"></i></span>
        <span class="muted small">${s.pkgSize ? `${d} of ${s.pkgSize} · ` : ""}${esc(s.subject.replace(/\s*\(H\)/, ""))}</span></button>`;
    }).join("")}</div>
  </section>`;
}
function vStudents() {
  const inactive = S.students.filter(s => !s.active);
  return `<div><h1>Students</h1><div class="muted">Click a student to see every class with your notes, or to change their details.</div></div>
  ${studentsCard()}
  ${inactive.length ? `<section class="card"><h2>Finished</h2><div class="studs">${inactive.map(s => `<button class="stud" data-act="student" data-sid="${s.id}"><b>${esc(s.name)}</b><span class="muted small">${esc(s.subject.replace(/\s*\(H\)/, ""))}</span></button>`).join("")}</div></section>` : ""}`;
}
function vLessons() {
  const we = L.addDays(weekStart, 6);
  if (!WEEKS[weekStart]) loadWeek(weekStart);
  const W = WEEKS[weekStart] || { loading: true, events: [] };
  const { blocks, allDay } = weekBlocks(weekStart);
  const ls = paidLessons(inRange(weekStart, we));
  let h0 = 8, h1 = 21;
  blocks.forEach(b => { h0 = Math.min(h0, Math.floor(toMin(b.start) / 60)); h1 = Math.max(h1, Math.ceil(toMin(b.end) / 60)); });
  h1 = Math.min(24, h1);
  const days = [...Array(7)].map((_, i) => L.addDays(weekStart, i));
  const nowLine = days.includes(TODAY) ? (() => { const n = new Date(), m = n.getHours() * 60 + n.getMinutes(); return m >= h0 * 60 && m <= h1 * 60 ? `<div class="nowline" style="top:${(m - h0 * 60) / 60 * HOUR_PX}px"></div>` : ""; })() : "";
  const title = `${fmtD(weekStart, { day: "numeric", month: "long" })} – ${fmtD(we, { day: "numeric", month: "long", year: "numeric" })}`;
  const grid = `<div class="cal-wrap"><div class="cal" style="--rows:${h1 - h0}">
    <div class="cal-head"><div class="gutter"></div>${days.map(d => `<div class="dh ${d === TODAY ? "now" : ""}"><span>${dow(d)}</span><b>${+d.slice(8)}</b></div>`).join("")}</div>
    ${allDay.length ? `<div class="cal-allday"><div class="gutter small muted">All day</div>${days.map(d => `<div class="adc">${allDay.filter(x => x.date === d).map(x => x.lesson
        ? `<button class="chip ${colorOf(x.lesson.studentId)}" data-act="pick" data-lid="${x.lesson.id}">${esc(nameOf(x.lesson))}${x.lesson.studentId ? " · " + esc(subjOf(x.lesson)) : ""}</button>`
        : `<span class="chip other" title="${esc(x.title)}">${esc(x.title)}</span>`).join("")}</div>`).join("")}</div>` : ""}
    <div class="cal-body"><div class="gutter">${[...Array(h1 - h0)].map((_, i) => `<div class="hr"><span>${((h0 + i) % 12 || 12)} ${h0 + i < 12 ? "AM" : "PM"}</span></div>`).join("")}</div>
      ${days.map(d => `<div class="dc ${d === TODAY ? "now" : ""}">${[...Array(h1 - h0)].map(() => `<div class="hr"></div>`).join("")}${layoutDay(blocks.filter(b => b.date === d)).map(b => blockHtml(b, h0)).join("")}${d === TODAY ? nowLine : ""}</div>`).join("")}
    </div></div></div>`;
  return `<div class="row-b"><div><h1>${title}</h1><div class="muted">${ls.length} class${ls.length === 1 ? "" : "es"} logged · ${hrs(sum(ls, l => +l.hours || 0))} · ${eur(sum(ls, L.amountOf))}${W.loading ? " · loading your calendar…" : W.error ? " · calendar not connected, showing usual times" : ""}</div></div>
    <div class="acts"><button class="btn" data-act="other">+ Other work</button><button class="btn sq" data-act="wk" data-n="-7" aria-label="Previous week">‹</button><button class="btn" data-act="wk" data-n="0">Today</button><button class="btn sq" data-act="wk" data-n="7" aria-label="Next week">›</button></div></div>
  <section class="card flush">${grid}<div class="legend small muted"><span><i class="lg done c1"></i>Done</span><span><i class="lg need c1"></i>Taught, needs notes</span><span><i class="lg plan c1"></i>Coming up</span><span><i class="lg other"></i>Other events</span><span class="sep"></span>${[...new Set(S.students.filter(s => s.active).map(s => subjectKey(s.subject)))].map(k => { const s = S.students.find(x => subjectKey(x.subject) === k); return `<span><i class="lg done ${subjectColor(s.subject)}"></i>${esc(subjectName(s.subject))}</span>`; }).join("")}</div></section>
  ${CAL.unmatched.length ? `<p class="muted small">Calendar events that aren't classes are shown in grey. If one of them is a class, open the student on the Students page and add a word from its title to their calendar keyword.</p>` : ""}`;
}
// A student's past classes, newest first, the way your Excel tabs show them
function historyTable(sid, opts = {}) {
  const hist = S.lessons.filter(l => l.studentId === sid && l.id !== opts.skip).sort((a, b) => b.date.localeCompare(a.date));
  if (!hist.length) return `<p class="empty">No earlier classes yet.</p>`;
  return `<div class="xl"><table><thead><tr><th>Date</th><th>Lesson</th><th>Topic covered</th><th>Homework</th><th>Remarks / notes</th></tr></thead><tbody>${hist.map(l => `<tr${opts.click ? ` data-act="openlesson" data-lid="${l.id}" tabindex="0"` : ""}><td class="nowrap">${fmtD(l.date, { day: "numeric", month: "short", year: "2-digit" })}</td><td class="nowrap">${l.kind === "class" ? (l.number ? esc(l.number) + (stu(sid)?.pkgSize ? " of " + stu(sid).pkgSize : "") : "") : esc(KINDS[l.kind])}</td><td class="pre">${esc(l.topic)}</td><td class="pre">${esc(l.homework)}</td><td class="pre">${esc(l.notes)}${l.followups ? `<div class="fu">To do: ${esc(l.followups)}</div>` : ""}</td></tr>`).join("")}</tbody></table></div>`;
}
function openPanel() {
  const m = panelModel();
  const side = m && m.studentId && !m._locked ? `<div class="hist-side"><h3>${esc(stu(m.studentId)?.name || "")}'s earlier classes</h3>${historyTable(m.studentId, { skip: m.id })}</div>` : "";
  openDlg(`<div class="${side ? "two" : ""}"><div id="panel" class="panel-d">${panel()}</div>${side}</div>`, side ? "wide" : "");
}

// Side panel: edit a logged lesson, log a planned one, or add other work
function panelModel() {
  if (!sel) return null;
  if (sel.lessonId) { const l = S.lessons.find(x => x.id === sel.lessonId); return l ? { ...l } : null; }
  if (sel.planned) { const p = sel.planned; return { studentId: p.studentId, date: p.date, time: p.time, hours: p.hours, rate: rateFor("class", p.date, p.studentId), kind: "", number: nextNumber(p.studentId), eventId: String(p.eventId).indexOf("slot-") === 0 ? "" : p.eventId, _new: true, _locked: !hasStarted(p) }; }
  if (sel.fromLine) { const f = sel.fromLine; return { ...f, _new: true, _other: !f.studentId }; }
  if (sel.other) return { studentId: "", label: "", date: TODAY, time: "", hours: 1, rate: rateFor("meeting", TODAY), kind: "meeting", _new: true, _other: true };
  return null;
}
function panel() {
  const m = panelModel();
  if (!m) return `<p class="empty">Pick a lesson to add notes or mark it taught.</p>`;
  const isOther = m._other || (!m.studentId && m.kind !== "class");
  const s = stu(m.studentId);
  if (m._locked) return `<span class="eyebrow">${fmtD(m.date, { weekday: "long", day: "numeric", month: "short" })}${m.time ? " · " + esc(m.time) : ""}</span><h2>${esc(s?.name || "")} · ${esc((s?.subject || "").replace(/\s*\(H\)/, ""))}</h2>
    ${line2("Lesson", m.number && s?.pkgSize ? `${m.number} of ${s.pkgSize}` : "—")}${line2("Length", hrs(m.hours))}${line2("Pay", eur(L.round2(m.hours * m.rate)))}
    <div class="note soft">You can add notes once this class starts at ${esc(m.time)} on ${fmtD(m.date, { weekday: "short", day: "numeric", month: "short" })}.</div>
    <p class="muted small">To move or cancel it, change it in Google Calendar, then press Sync calendar.</p><div class="acts end"><button class="btn" data-act="close">Close</button></div>`;
  const orphan = m.id && CAL.orphans.includes(m.id) ? `<div class="note warn">${ICON.alert}<span>This class is no longer in your calendar. Was it cancelled or moved?</span></div><div class="acts"><button class="btn" data-act="orphankeep" data-lid="${m.id}">Keep it, it happened</button><button class="btn ghost danger" data-act="orphandel" data-lid="${m.id}">Remove it</button></div>` : "";
  const head = isOther ? `<span class="eyebrow">${m._new ? "Add other work" : fmtD(m.date, { weekday: "long", day: "numeric", month: "short" })}</span><h2>${esc(m.label || KINDS[m.kind])}</h2>`
    : `<span class="eyebrow">${fmtD(m.date, { weekday: "long", day: "numeric", month: "short" })}${m.time ? " · " + esc(m.time) : ""}</span><h2>${esc(s?.name || "")}${m.number ? " · lesson " + m.number : ""}</h2>`;
  const status = isOther ? `<div class="f2">
      <label class="fld">Type<select id="p_kind">${OTHER_KINDS.map(k => `<option value="${k}" ${k === m.kind ? "selected" : ""}>${KINDS[k]}</option>`).join("")}</select></label>
      <label class="fld">Date<input id="p_date" type="date" value="${esc(m.date)}" max="${TODAY}"></label></div>
      <label class="fld">Description<textarea id="p_label" rows="1" placeholder="e.g. Parent-teacher meeting">${esc(m.label)}</textarea></label>`
    : `<div class="seg" role="group" aria-label="What happened">${["class", "noshow", "cancelled"].map(k => `<button type="button" class="${(m.kind || "") === k ? "on" : ""}" data-act="kind" data-k="${k}">${KINDS[k]}</button>`).join("")}</div>`;
  const pay = `<details class="pay" ${isOther ? "open" : ""}><summary>Pay: ${hrs(m.kind === "cancelled" ? 0 : m.hours)} × ${eur(m.rate)} = <b>${eur(L.amountOf(m))}</b></summary>
    <div class="f3"><label class="fld">Hours<input id="p_hours" type="number" step="0.25" min="0" value="${esc(m.hours)}"></label><label class="fld">Rate €/h<input id="p_rate" type="number" step="0.5" min="0" value="${esc(m.rate)}"></label>${isOther ? "" : `<label class="fld">Lesson #<input id="p_num" type="number" min="0" value="${esc(m.number ?? "")}"></label>`}</div></details>`;
  const notes = isOther ? `<label class="fld">Notes<textarea id="p_notes" rows="3">${esc(m.notes)}</textarea></label>` : `
    <label class="fld">Topic covered<textarea id="p_topic" rows="2" placeholder="e.g. Ch 13: Differential Calculus">${esc(m.topic)}</textarea></label>
    <label class="fld">Homework<textarea id="p_hw" rows="1" placeholder="e.g. Ex 13.4">${esc(m.homework)}</textarea></label>
    <label class="fld">Notes<textarea id="p_notes" rows="4" placeholder="How did it go? What's next?">${esc(m.notes)}</textarea></label>
    <label class="fld">To do after class<textarea id="p_fu" rows="1" placeholder="e.g. Send the notes">${esc(m.followups)}</textarea></label>`;
  const autoNote = sel.planned && sel.planned.started && !CAL.error ? `<p class="muted small">If you leave it, it's marked taught after it ends, but it only goes on your Payment Claim once you add details.</p>` : m.source === "calendar" && !m.topic && !m.notes && m.kind === "class" ? `<p class="muted small">Logged from your calendar. Add details to put it on your Payment Claim.</p>` : "";
  return `${head}${orphan}${status}${notes}${pay}${autoNote}
    <div class="acts end">${!m._new ? `<button class="btn ghost danger" data-act="dellesson" data-lid="${m.id}">Delete</button>` : ""}<button class="btn ghost" data-act="close">Cancel</button><button class="btn primary" data-act="savelesson">Save</button></div>`;
}
let panelKind = null;
function collectPanel() {
  const m = panelModel(); if (!m) return null;
  const v = id => { const e = $("#" + id); return e ? e.value.trim() : undefined; };
  const n = id => { const x = v(id); return x === undefined ? undefined : x === "" ? null : +x; };
  const d = { ...m };
  ["_new", "_other"].forEach(k => delete d[k]); delete d.id;
  if (panelKind) d.kind = panelKind;
  if (m._other || $("#p_kind")) { d.kind = v("p_kind"); d.label = v("p_label") || KINDS[d.kind]; d.date = v("p_date") || d.date; d.studentId = ""; }
  if (!d.kind) d.kind = "class";
  const set = (k, x) => { if (x !== undefined) d[k] = x; };
  set("hours", n("p_hours")); set("rate", n("p_rate")); set("number", n("p_num"));
  set("topic", v("p_topic")); set("homework", v("p_hw")); set("notes", v("p_notes")); set("followups", v("p_fu"));
  if (d.followups === "") d.followupsDone = false;
  d.updatedAt = new Date().toISOString(); d.source = d.source || (m.eventId ? "calendar" : "manual");
  return { id: m.id || (m.eventId ? "cal-" : "m-") + uid(), data: d };
}

function vPayslips() {
  const ps = periods().slice().reverse();
  if (!selPeriod || !ps.some(p => p.key === selPeriod)) selPeriod = (ps.find(p => p.status === "slip" || p.status === "paid") || ps[0] || {}).key;
  const p = ps.find(x => x.key === selPeriod);
  const rows = ps.map(x => { const [c, t] = PSTAT(x); return `<tr class="${x.key === selPeriod ? "sel" : ""}" data-act="period" data-k="${x.key}" tabindex="0">
    <td><b>${x.name}</b>${x.year !== +TODAY.slice(0, 4) ? " " + x.year : ""}<br><span class="muted small">${fmtD(x.start)} – ${fmtD(x.end)} · ${Math.round(x.weeks)} weeks</span></td>
    <td class="r num">${eur(x.logged)}</td><td class="r num b">${x.slip && x.slip.gross != null ? eur(x.slip.gross) : `<span class="muted">—</span>`}</td><td>${pill(c, t)}</td></tr>`; }).join("");
  const wk = S.statements.filter(s => s.week).sort((a, b) => b.week.start.localeCompare(a.week.start));
  const issByStmt = Object.fromEntries(issues().filter(g => g.stmt).map(g => [g.stmt.id, g.list.length]));
  return `<div class="row-b"><div><h1>Payslips</h1><div class="muted">Pay periods run Monday to the last Sunday of the month. Money arrives around the 15th of the next month.</div></div><span class="acts">${/^running/.test(STATUS.oldSearch || "") ? `<span class="pill due">Searching your email…</span>` : `<button class="btn ghost" data-act="findold">Find old payslip PDFs</button>`}<button class="btn" data-act="newslip">Add payslip</button></span></div>
  <section class="split2 top">
    <div class="card flush grow2"><div class="tw"><table><thead><tr><th>Pay period</th><th class="r">You logged</th><th class="r">Payslip</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div></div>
    <aside class="card panel">${p ? slipPanel(p) : `<p class="empty">No pay periods yet.</p>`}</aside>
  </section>
  <section class="card"><h2>Admin's weekly emails</h2>
    ${wk.length ? wk.map(s => { const n = issByStmt[s.id] || 0; return `<div class="li"><div class="grow"><b>${fmtD(s.week.start)} – ${fmtD(s.week.end)}</b> <span class="muted small">· ${(s.lines || []).length} lines</span></div><span class="num b">${eur(stmtTotal(s))}</span>${s.resolved ? pill("open", "Sorted") : n ? `<button class="pill bad" data-act="issues">${n} pay problem${n > 1 ? "s" : ""}</button>` : pill("ok", "Matches")}</div>`; }).join("") : `<p class="empty">None yet. They're picked up from your Gmail every Monday and Tuesday morning.</p>`}
    <details class="paste"><summary>Paste an email by hand</summary><textarea id="raw" rows="5" placeholder="Paste the whole weekly wages email here"></textarea><div class="acts"><button class="btn" data-act="pastecheck">Add this week</button></div></details>
  </section>`;
}
function slipPanel(p) {
  const s = p.slip, refund = s && s.net != null && s.gross != null ? L.round2(s.net - s.gross) : s ? -((+s.paye || 0) + (+s.usc || 0)) : 0;
  const match = !s || s.gross == null ? "" : L.cents(s.gross) === L.cents(p.logged)
    ? `<div class="note good">${ICON.ok}<span>Matches your ${p.lessons.length} lessons${p.stmts.length ? ` and admin's ${p.stmts.length} weekly email${p.stmts.length > 1 ? "s" : ""}` : ""}</span></div>`
    : `<div class="note bad">${ICON.alert}<span>Your lessons add up to ${eur(p.logged)}, ${eur(Math.abs(p.logged - s.gross))} ${p.logged > s.gross ? "more" : "less"} than the payslip</span></div>`;
  const line = (k, v, cls = "") => `<div class="kv ${cls}"><span>${k}</span><span>${v}</span></div>`;
  if (!s) return `<span class="eyebrow">${fmtD(p.start)} – ${fmtD(p.end)}</span><h2>${p.name}</h2>
    ${line("Your lessons", `<b>${eur(p.logged)}</b>`)}${line("Work", `${p.lessons.length} items · ${hrs(p.hours)}`)}${line("Admin's weekly emails", `${p.stmts.length} of ${Math.round(p.weeks)} · ${eur(p.confirmed)}`)}${line(p.status === "open" ? "Paid by" : "Expected by", fmtD(p.due, { day: "numeric", month: "long" }))}
    <p class="muted small">${p.status === "open" ? "This period is still running." : "The payslip usually arrives by email at the end of the month. It's added automatically."}</p>
    <div class="acts end"><button class="btn" data-act="newslip" data-k="${p.key}">Add payslip by hand</button></div>`;
  return `<span class="eyebrow">${s.number ? "Payslip " + s.number + " · " : ""}${s.payDate ? fmtD(s.payDate) : fmtD(p.start) + " – " + fmtD(p.end)}</span><h2>${p.name}</h2>
    ${s.needsCheck ? `<div class="note warn">${ICON.alert}<span>The amounts couldn't be read from the PDF yet.</span></div><div class="acts">${s.pdfUrl ? `<button class="btn" data-act="reread" data-pid="${s.id}">Read the PDF again</button>` : ""}<button class="btn ghost" data-act="editslip" data-pid="${s.id}">Type them in</button></div>` : ""}
    ${line("Gross pay", `<b>${s.gross != null ? eur(s.gross) : "—"}</b>`)}
    ${refund ? line(refund > 0 ? "Tax refund" : "Tax and deductions", (refund > 0 ? "+" : "−") + eur(Math.abs(refund))) : ""}
    ${s.net != null ? line("You received", `<b class="big3">${eur(s.net)}</b>`, "total") : ""}
    ${line("Arrived", s.receivedDate ? fmtD(s.receivedDate) : `<button class="btn small-b" data-act="received" data-pid="${s.id}">Mark received</button>`)}
    ${s.cumulativeGross != null ? line("Year to date (gross)", eur(s.cumulativeGross)) : ""}
    ${match}
    <div class="acts">${s.pdfUrl ? `<a class="btn grow" href="${esc(s.pdfUrl)}" target="_blank" rel="noopener">Open payslip PDF</a>` : ""}<button class="btn ghost" data-act="editslip" data-pid="${s.id}">Edit</button></div>`;
}


// ---- Payment Claim: like your Excel tab. A class appears once you've taught it and entered its details. ----
let claimFilter = "all";
const SESSION = { class: "Class", noshow: "No-show (part pay)", demo: "Demo / trial", meeting: "Meeting", reports: "Student reports", prep: "Lesson prep", other: "Other" };
const onClaim = l => l.kind !== "cancelled" && (l.source === "history" || !l.studentId || !!(l.topic || l.notes));
const claimLabel = l => l.studentId ? `${(stu(l.studentId)?.subject || "").replace(/\s*\(H\)/, "")} – ${nameOf(l)}` : (l.label || SESSION[l.kind]);
function claimData() {
  const per = periods(), rows = S.lessons.filter(onClaim).sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));
  const pOf = d => per.find(p => d >= p.start && d <= p.end) || L.periodFor(d);
  const out = rows.map(l => {
    const p = pOf(l.date), st = p.status === "paid" ? "Paid" : p.status === "slip" ? "Payslip in" : "Not yet paid";
    const note = p.status === "paid" ? `${p.name} pay · arrived ${fmtD(p.slip.receivedDate)}` : `${p.name} pay · due ${fmtD(p.due)}`;
    return { l, p, status: st, note, amount: L.amountOf(l) };
  });
  const waiting = S.lessons.filter(l => l.kind !== "cancelled" && l.studentId && !onClaim(l));
  return { rows: out, waiting };
}
function claimTSV() {
  const { rows } = claimData();
  return [["Date", "Class / Student", "Session", "Duration (hours)", "Rate (€)", "Amount (€)", "Payment status", "Payroll / note"].join("\t"),
    ...rows.map(r => [fmtD(r.l.date, { day: "2-digit", month: "short", year: "numeric" }), claimLabel(r.l), SESSION[r.l.kind], r.l.hours, r.l.rate, r.amount.toFixed(2), r.status, r.note].join("\t"))].join("\n");
}
function vClaim() {
  const { rows, waiting } = claimData();
  const tot = f => sum(rows.filter(f), r => r.amount);
  const earned = tot(() => true), paid = tot(r => r.status === "Paid"), slipIn = tot(r => r.status === "Payslip in"), unpaid = tot(r => r.status === "Not yet paid");
  const shown = rows.filter(r => claimFilter === "all" || (claimFilter === "unpaid" ? r.status !== "Paid" : r.status === "Paid"));
  const groups = [...new Set(shown.map(r => r.p.key))].reverse();
  const cls = st => st === "Paid" ? "ok" : st === "Payslip in" ? "due" : "open";
  const tile = (k, v, c = "") => `<div class="tile ${c}"><span class="eyebrow">${k}</span><b>${eur(v)}</b></div>`;
  return `<div class="row-b"><div><h1>Payment claim</h1><div class="muted">${esc(PROFILE.teacherName || "")} · ${rows.length} items since ${rows[0] ? fmtD(rows[0].l.date, { day: "numeric", month: "long", year: "numeric" }) : "—"}</div></div>
    <button class="btn" data-act="copyclaim">Copy as table</button></div>
  <section class="tiles">${tile("Total earned", earned)}${tile("Paid", paid, "good")}${slipIn ? tile("Payslip in, money due", slipIn, "due") : ""}${tile("Not yet paid", unpaid, "due")}</section>
  ${waiting.length ? `<div class="note warn">${ICON.alert}<span>${waiting.length} class${waiting.length > 1 ? "es are" : " is"} not on the claim yet because ${waiting.length > 1 ? "they have" : "it has"} no details: ${waiting.slice(0, 3).map(l => `<button class="link" data-act="openlesson" data-lid="${l.id}">${esc(nameOf(l))} ${fmtD(l.date)}</button>`).join(", ")}${waiting.length > 3 ? "…" : ""}</span></div>` : ""}
  <section class="card flush">
    <div class="row-b pad"><h2>Classes</h2><div class="seg sm" role="group" aria-label="Show">${[["all", "All"], ["unpaid", "Not paid yet"], ["paid", "Paid"]].map(([k, t]) => `<button type="button" class="${claimFilter === k ? "on" : ""}" data-act="claimf" data-k="${k}">${t}</button>`).join("")}</div></div>
    <div class="claim-scroll"><table class="claim"><thead><tr><th>Date</th><th>Class / Student</th><th>Session</th><th class="r">Hours</th><th class="r">Rate</th><th class="r">Amount</th><th>Status</th></tr></thead>
    <tbody>${groups.map((k, gi) => { const g = shown.filter(r => r.p.key === k), p = g[0].p, band = "b" + (gi % 4);
      return `<tr class="grp-h ${band}"><td colspan="5"><b>${p.name} ${p.year}</b> <span class="muted small">· ${fmtD(p.start)} – ${fmtD(p.end)} · ${g.length} item${g.length > 1 ? "s" : ""} · ${g[0].note.replace(/^[A-Za-z]+ pay · /, "")}</span></td><td class="r num b">${eur(sum(g, r => r.amount))}</td><td>${pill(cls(g[0].status), g[0].status)}</td></tr>`
        + g.slice().reverse().map((r, ri) => `<tr class="row ${band} ${ri % 2 ? "odd" : ""}" data-act="openlesson" data-lid="${r.l.id}" tabindex="0"><td class="nowrap num">${fmtD(r.l.date, { weekday: "short", day: "numeric", month: "short" })}</td><td><span class="sdot ${r.l.studentId ? colorOf(r.l.studentId) : "cx"}"></span>${esc(claimLabel(r.l))}</td><td>${SESSION[r.l.kind]}</td><td class="r num">${+r.l.hours}</td><td class="r num">${eur(r.l.rate)}</td><td class="r num b">${eur(r.amount)}</td><td>${pill(cls(r.status), r.status)}</td></tr>`).join("");
    }).join("") || `<tr><td colspan="7" class="empty">Nothing here.</td></tr>`}</tbody></table></div>
  </section>`;
}

// ---- Profile ----
function vProfile() {
  const cur = RATES.filter(x => x.from <= TODAY).sort((a, b) => a.from.localeCompare(b.from)).pop() || { class: 35, trial: 35, other: 20 };
  const hist = RATES.slice().sort((a, b) => b.from.localeCompare(a.from));
  return `<div><h1>Profile</h1><div class="muted">Your details, rates and how SideQuest connects to your calendar and email.</div></div>
  <section class="split2 top">
    <div class="card grow2"><h2>Rates</h2>
      <div class="tiles in">${[["Classes", cur.class], ["Trials & demos", cur.trial], ["Meetings, reports, prep", cur.other]].map(([k, v]) => `<div class="tile"><span class="eyebrow">${k}</span><b>${eur(v)}<span class="muted small"> /h</span></b></div>`).join("")}</div>
      <h3>Change rates</h3>
      <div class="f3">${fld("rt_class", "Classes €/h", cur.class, "number", 'step="0.5" min="0"')}${fld("rt_trial", "Trials & demos €/h", cur.trial, "number", 'step="0.5" min="0"')}${fld("rt_other", "Meetings, reports, prep €/h", cur.other, "number", 'step="0.5" min="0"')}</div>
      <div class="f2">${fld("rt_from", "Applies from", TODAY, "date")}<label class="chk"><input type="checkbox" id="rt_apply"> Also update unpaid classes already logged from that date</label></div>
      <div class="acts end"><button class="btn primary" data-act="saverates">Save rates</button></div>
      <p class="muted small">Classes keep the rate they were logged at, so changing rates never rewrites what you've been paid. A student with their own rate (set on the student) keeps it. No-shows: pick No-show on the class and the hours start at half; change them if admin pays differently.</p>
      <h3>Rate history</h3>
      <div class="tw"><table><thead><tr><th>From</th><th class="r">Classes</th><th class="r">Trials</th><th class="r">Meetings etc.</th></tr></thead><tbody>${hist.map(r => `<tr><td>${fmtD(r.from, { day: "numeric", month: "short", year: "numeric" })}</td><td class="r num">${eur(r.class)}</td><td class="r num">${eur(r.trial)}</td><td class="r num">${eur(r.other)}</td></tr>`).join("")}</tbody></table></div>
    </div>
    <aside class="card panel"><h2>You</h2>
      <div class="me"><span class="avatar big">${avatar()}</span><span class="acts"><label class="btn" for="pr_photo">Change photo</label><input id="pr_photo" type="file" accept="image/*" class="sr">${PROFILE.photo ? `<button class="btn ghost" data-act="nophoto">Remove</button>` : ""}</span></div>
      <div class="fld">Theme<div class="seg" role="group" aria-label="Theme">${[["light", "Light"], ["dark", "Dark"], ["system", "Match my computer"]].map(([k, t]) => `<button type="button" class="${(PROFILE.theme || "light") === k ? "on" : ""}" data-act="theme" data-k="${k}">${t}</button>`).join("")}</div></div>
      ${fld("pr_name", "Your name", PROFILE.teacherName)}
      ${fld("pr_email", "Email address", PROFILE.email, "email")}
      <label class="fld">Subjects you teach<input id="pr_subj" value="${esc(PROFILE.subjects || "")}" placeholder="e.g. Leaving Cert Maths (H), Applied Maths (H)"></label>
      <label class="fld">Calendar with your classes<input id="pr_cal" value="${esc(PROFILE.calendarId || "primary")}"><span class="muted small" style="font-weight:400">"primary" is your main Google Calendar. For another one, paste its Calendar ID from Google Calendar → Settings.</span></label>
      <label class="chk"><input type="checkbox" id="pr_auto" ${PROFILE.autoLog !== "no" ? "checked" : ""}> Log classes from my calendar once they end</label>
      ${fld("pr_from", "Wages emails come from", PROFILE.senders, "text", 'placeholder="admin@agency.com"')}
      ${fld("pr_admin", "Their first name (for draft emails)", PROFILE.adminName)}
      <label class="chk"><input type="checkbox" id="pr_mail" ${PROFILE.emailSummary !== "no" ? "checked" : ""}> Email me when there's a pay problem or a new payslip</label>
      <div class="acts end"><button class="btn primary" data-act="saveprofile">Save</button></div>
    </aside>
  </section>`;
}

// ---- Dialogs ----
const dlg = () => $("#dlg");
function openDlg(html, cls = "") {
  const d = dlg(); d.className = cls; d.innerHTML = `<button class="x" data-act="close" aria-label="Close">×</button>` + html;
  if (!d.open) d.showModal(); growAll(d); d.scrollTop = 0;
}
const fld = (id, label, val, type = "text", extra = "") => `<label class="fld">${label}<input id="${id}" type="${type}" value="${esc(val ?? "")}" ${extra}></label>`;
const dv = id => $("#" + id).value.trim(), dn = id => { const x = dv(id); return x === "" ? null : +x; };

function issuesDlg() {
  const g = issues();
  openDlg(`<h2>Pay problems</h2><p class="muted small">Only things that change what you're paid are listed here.</p>
    ${g.length ? g.map(x => `<div class="grp"><div class="row-b"><b>${esc(x.title)}</b><span class="acts">${x.stmt ? `<button class="btn ghost" data-act="draft" data-id="${x.key}">Draft email</button><button class="btn ghost" data-act="sorted" data-id="${x.key}">Mark sorted</button>` : `<button class="btn ghost" data-act="slipok" data-pid="${x.slipId}">It's fine</button>`}</span></div>
      <ul>${x.list.map(i => `<li>${i.date ? `<span class="muted">${fmtD(i.date)}</span> ` : ""}${esc(i.text)}${i.lessonId ? ` <button class="link" data-act="openlesson" data-lid="${i.lessonId}">Open lesson</button>` : ""}${i.line ? ` <button class="link" data-act="fromline" data-g="${esc(x.key)}" data-i="${x.list.indexOf(i)}">Add it to my lessons</button>` : ""}</li>`).join("")}</ul></div>`).join("") : `<p class="empty">Nothing to look at.</p>`}
    <div class="acts end"><button class="btn" data-act="close">Close</button></div>`);
}
function draftDlg(id) {
  const g = issues().find(x => x.key === id); if (!g) return;
  const text = `Hi ${PROFILE.adminName || "there"},\n\nI checked the weekly wages for ${g.title.replace("Week of ", "")} against my records and found:\n\n${g.list.map(i => "- " + (i.date ? fmtD(i.date) + ": " : "") + i.text).join("\n")}\n\nCould you take a look when you get a chance?\n\nThanks,\n${(PROFILE.teacherName || "").split(" ")[0] || ""}`;
  openDlg(`<h2>Email to admin</h2><p class="muted small">Copy this into your email. Nothing is sent from here.</p><textarea id="dtext" rows="12">${esc(text)}</textarea>
    <div class="acts end"><button class="btn ghost" data-act="issues">Back</button><button class="btn primary" data-act="copy">Copy text</button></div>`);
}
function studentDlg(s) {
  const hist = s.id ? S.lessons.filter(l => l.studentId === s.id).sort((a, b) => b.date.localeCompare(a.date)) : [];
  openDlg(`<h2>${s.id ? esc(s.name) + " · " + esc(s.subject) : "Add student"}</h2>
    <form id="sf" class="f3">
      ${fld("s_n", "Name", s.name, "text", "required")}${fld("s_sub", "Subject", s.subject, "text", 'placeholder="G12 Maths (H)"')}${fld("s_k", "Calendar keyword", s.calKeyword ?? s.name, "text", 'placeholder="Word(s) in the calendar event title"')}
      ${fld("s_c", "Course code (admin's emails)", s.code, "text", 'placeholder="IE1042"')}${fld("s_h", "Usual lesson length (h)", s.hours ?? 1, "number", 'step="0.25" min="0"')}${fld("s_r", "Own rate €/h (optional)", s.ownRate, "number", 'step="0.5" min="0" placeholder="Uses your Profile rate"')}
      ${fld("s_p", "Package size (lessons)", s.pkgSize, "number", 'min="0"')}
      <label class="fld span2">Notes<textarea id="s_notes" rows="1">${esc(s.notes)}</textarea></label>
      <label class="chk span3"><input type="checkbox" id="s_a" ${s.active !== false ? "checked" : ""}> Currently teaching</label>
    </form>
    <div class="acts end">${s.id ? `<button class="btn ghost danger" data-act="delstu" data-sid="${s.id}">Delete</button>` : ""}<button class="btn ghost" data-act="close">Cancel</button><button class="btn primary" data-act="savestu" data-sid="${s.id || ""}">Save</button></div>
    ${hist.length ? `<h3>All classes</h3><p class="muted small">Click a row to open it.</p>${historyTable(s.id, { click: true })}` : ""}`, s.id ? "wide" : "");
}
function slipDlg(s, p) {
  openDlg(`<h2>${s.id ? "Edit payslip" : "Add payslip"}</h2>
    ${s.id ? "" : `<label class="fld">Paste the payslip text (optional)<textarea id="p_raw" rows="3" placeholder="Open the PDF, select all, copy, paste here"></textarea></label><div class="acts"><button class="btn ghost" data-act="fillslip">Fill in from text</button></div>`}
    <div class="f3">${fld("q_ps", "Covers from", s.periodStart || p?.start, "date")}${fld("q_pe", "Covers to", s.periodEnd || p?.end, "date")}${fld("q_no", "Payslip number", s.number, "number")}
    ${fld("q_d", "Payment date", s.payDate, "date")}${fld("q_g", "Gross pay (€)", s.gross, "number", 'step="0.01"')}${fld("q_n", "Net pay (€)", s.net, "number", 'step="0.01"')}
    ${fld("q_paye", "PAYE (€)", s.paye, "number", 'step="0.01"')}${fld("q_usc", "USC (€)", s.usc, "number", 'step="0.01"')}${fld("q_cum", "Year-to-date gross (€)", s.cumulativeGross, "number", 'step="0.01"')}
    ${fld("q_rec", "Money arrived on", s.receivedDate, "date")}</div>
    <div class="acts end">${s.id ? `<button class="btn ghost danger" data-act="delslip" data-pid="${s.id}">Delete</button>` : ""}<button class="btn ghost" data-act="close">Cancel</button><button class="btn primary" data-act="saveslip" data-pid="${s.id || ""}">Save</button></div>`);
}

// ---- Events ----
let delArm = null;
function armDelete(t, key) { if (delArm === key) { delArm = null; return true; } delArm = key; t.textContent = "Click again to delete"; setTimeout(() => { if (delArm === key) { delArm = null; t.textContent = "Delete"; } }, 3000); return false; }
document.addEventListener("click", async e => {
  const t = e.target.closest("[data-act]"); if (!t || t.disabled) return;
  const a = t.dataset.act, D = t.dataset;
  if (t.tagName === "A") return;
  if (a === "nav") { view = D.v; sel = null; panelKind = null; render(); return scrollTo(0, 0); }
  if (a === "reload") { loadErr = ""; render(); return load(); }
  if (a === "close") { sel = null; panelKind = null; return dlg().close(); }
  if (a === "runnow") {
    t.disabled = true; const old = t.textContent; t.textContent = "Checking…";
    try { const r = await gs("api_runNow"); applyAll(r.data); toast(r.results.length ? r.results.map(x => x.result).join(" ") : "No new wages emails.", 7000); }
    catch (er) { toast("Email check failed: " + (er.message || er), 7000); }
    t.disabled = false; t.textContent = old; return;
  }
  if (a === "issues") return issuesDlg();
  if (a === "draft") return draftDlg(D.id);
  if (a === "copy") { const x = $("#dtext"); try { await navigator.clipboard.writeText(x.value); toast("Copied"); } catch { x.select(); toast("Selected. Press Ctrl+C to copy."); } return; }
  if (a === "sorted") { const s = S.statements.find(x => x.id === D.id); await save("statements", s.id, { ...strip(s), resolved: true }); return issuesDlg(); }
  if (a === "slipok") { const s = S.payslips.find(x => x.id === D.pid); await save("payslips", s.id, { ...strip(s), mismatchOk: true }); return issuesDlg(); }
  if (a === "claimf") { claimFilter = D.k; return render(); }
  if (a === "period") { selPeriod = D.k; if (view !== "payslips") { view = "payslips"; scrollTo(0, 0); } return render(); }
  if (a === "wk") { weekStart = +D.n === 0 ? L.mondayOf(TODAY) : L.addDays(weekStart, +D.n); sel = null; panelKind = null; return render(); }
  if (a === "fromline") {
    const g = issues().find(x => x.key === D.g), it = g && g.list[+D.i]; if (!it) return;
    const ln = it.line, looksOther = /meeting|parent|report|prep|trial/i.test(ln.label) || !it.studentId;
    sel = { fromLine: { studentId: looksOther ? "" : it.studentId, date: ln.date, time: ln.time || "", hours: ln.hours, rate: ln.rate, kind: looksOther ? (/trial/i.test(ln.label) ? "demo" : "meeting") : "class",
      label: looksOther ? ln.label.replace(/Lesson\(\d+\)-\d+\s*/, "").replace(/\b(IE\d+|T\d+)\b\s*/, "").trim() : "", number: looksOther ? null : ln.counter, notes: "Added from admin's weekly email." } };
    panelKind = null; return openPanel();
  }
  if (a === "pick") { sel = { lessonId: D.lid }; panelKind = null; return openPanel(); }
  if (a === "pickplan") { const b = weekBlocks(weekStart).blocks.find(x => x.planned && x.planned.eventId === D.eid); if (!b) return; sel = { planned: b.planned }; panelKind = null; return openPanel(); }
  if (a === "other") { sel = { other: true }; panelKind = null; return openPanel(); }
  if (a === "openlesson") { const l = S.lessons.find(x => x.id === D.lid); if (!l) return; sel = { lessonId: l.id }; panelKind = null; return openPanel(); }
  if (a === "kind") {
    const prev = panelKind || panelModel()?.kind; panelKind = D.k; t.parentElement.querySelectorAll("button").forEach(b => b.classList.toggle("on", b === t));
    const h = $("#p_hours"), m = panelModel();
    if (h && m) {
      const full = m.kind === "noshow" ? (stu(m.studentId)?.hours || m.hours) : m.hours;
      if (D.k === "noshow" && prev !== "noshow") { h.value = L.round2(full / 2); $("#panel details.pay").open = true; toast("No-show set to half pay. Change the hours if admin pays differently."); }
      if (D.k !== "noshow" && prev === "noshow") h.value = full;
      h.dispatchEvent(new Event("input", { bubbles: true }));
    }
    return;
  }
  if (a === "savelesson") {
    const r = collectPanel(); if (!r) return;
    sel = null; panelKind = null; dlg().close(); await save("lessons", r.id, r.data); return toast("Saved");
  }
  if (a === "dellesson") { if (!armDelete(t, a + D.lid)) return; sel = null; dlg().close(); await remove("lessons", D.lid); return toast("Deleted"); }
  if (a === "student") return studentDlg(stu(D.sid) || {});
  if (a === "newstu") return studentDlg({ active: true });
  if (a === "savestu") {
    if (!dv("s_n")) return toast("Add a name.");
    const old = stu(D.sid) || {};
    const data = { ...strip(old), name: dv("s_n"), subject: dv("s_sub"), calKeyword: dv("s_k") || dv("s_n"), code: dv("s_c").toUpperCase(), hours: dn("s_h") ?? 1, ownRate: dn("s_r"), pkgSize: dn("s_p"), notes: dv("s_notes"), active: $("#s_a").checked, priorCount: old.priorCount || 0 };
    dlg().close(); await save("students", D.sid || "s-" + uid(), data); toast("Saved. Calendar changes show next time the page loads."); return;
  }
  if (a === "delstu") { if (!armDelete(t, a + D.sid)) return; dlg().close(); return remove("students", D.sid); }
  if (a === "todo" && D.t === "slip") { const sl = S.payslips.find(x => x.id === D.pid); view = "payslips"; selPeriod = sl && sl.periodEnd ? (periods().find(p => p.end === sl.periodEnd) || {}).key || selPeriod : selPeriod; render(); return scrollTo(0, 0); }
  if (a === "todo") {
    if (D.t === "open" || D.t === "fudone") { sel = { lessonId: D.lid }; panelKind = null; return openPanel(); }
    if (D.t === "student") return studentDlg(stu(D.sid));
    if (D.t === "slip") { const s = S.payslips.find(x => x.id === D.pid); return slipDlg(s); }
    if (D.t === "mine") return;
  }
  if (a === "fudone") { const l = S.lessons.find(x => x.id === D.lid); return save("lessons", l.id, { ...strip(l), followupsDone: true }); }
  if (a === "minedone") {
    const x = S.todos.find(y => y.id === D.tid), k = x.key || x.text.trim().toLowerCase();
    for (const y of S.todos.filter(y => !y.done && (y.key || y.text.trim().toLowerCase()) === k)) await save("todos", y.id, { ...strip(y), done: true });
    return;
  }
  if (a === "orphankeep") { const l = S.lessons.find(x => x.id === D.lid); CAL.orphans = CAL.orphans.filter(i => i !== l.id); dlg().close(); await save("lessons", l.id, { ...strip(l), eventId: "kept" }); return toast("Kept"); }
  if (a === "orphandel") { CAL.orphans = CAL.orphans.filter(i => i !== D.lid); sel = null; dlg().close(); await remove("lessons", D.lid); return toast("Removed"); }
  if (a === "theme") { PROFILE.theme = D.k; applyTheme(); t.parentElement.querySelectorAll("button").forEach(b => b.classList.toggle("on", b === t)); try { await gs("api_saveProfile", { theme: D.k }); } catch (er) { toast("Couldn't save the theme: " + (er.message || er)); } return; }
  if (a === "nophoto") { try { applyAll(await gs("api_saveProfile", { photo: "" })); toast("Photo removed"); } catch (er) { toast("Couldn't save: " + (er.message || er)); } return; }
  if (a === "sync") {
    t.disabled = true; const old = t.textContent; t.textContent = "Syncing…";
    try { applyAll(await gs("api_sync")); Object.keys(WEEKS).forEach(k => delete WEEKS[k]); if (view === "lessons") loadWeek(weekStart, true); if (!CAL.created) toast(CAL.error ? CAL.error : `Calendar synced. ${CAL.planned.length} upcoming class${CAL.planned.length === 1 ? "" : "es"}.`); }
    catch (er) { toast("Sync failed: " + (er.message || er), 6000); }
    t.disabled = false; t.textContent = old; return;
  }
  if (a === "copyclaim") { const txt = claimTSV(); try { await navigator.clipboard.writeText(txt); toast("Copied. Paste it into Excel or an email."); } catch { toast("Your browser blocked copying."); } return; }
  if (a === "saveprofile") {
    const p = { teacherName: dv("pr_name"), adminName: dv("pr_admin"), email: dv("pr_email"), subjects: dv("pr_subj"), calendarId: dv("pr_cal") || "primary", autoLog: $("#pr_auto").checked ? "yes" : "no", emailSummary: $("#pr_mail").checked ? "yes" : "no", senders: dv("pr_from") };
    t.disabled = true; try { applyAll(await gs("api_saveProfile", p)); toast("Profile saved"); } catch (er) { toast("Couldn't save: " + (er.message || er)); } t.disabled = false; return;
  }
  if (a === "saverates") {
    const r = { from: dv("rt_from"), class: dn("rt_class"), trial: dn("rt_trial"), other: dn("rt_other") };
    if (!r.from || [r.class, r.trial, r.other].some(x => x == null)) return toast("Fill in the date and all three rates.");
    t.disabled = true; try { applyAll(await gs("api_setRates", r, $("#rt_apply").checked)); toast("Rates saved"); } catch (er) { toast("Couldn't save: " + (er.message || er)); } t.disabled = false; return;
  }
  if (a === "received") { const s = S.payslips.find(x => x.id === D.pid); await save("payslips", s.id, { ...strip(s), receivedDate: TODAY }); return toast("Marked as arrived today. Click Edit to change the date."); }
  if (a === "newslip") { const p = periods().find(x => x.key === (D.k || selPeriod)); return slipDlg({}, p); }
  if (a === "findold") {
    t.disabled = true;
    try { const r = await gs("api_findOldPayslips"); applyAll(r.data); toast(r.started ? "Searching your email in the background. You can keep using SideQuest or close it; you'll see the result here." : "A search is already running.", 7000); }
    catch (er) { toast("Couldn't start the search: " + (er.message || er)); }
    t.disabled = false; return;
  }
  if (a === "editslip") return slipDlg(S.payslips.find(x => x.id === D.pid));
  if (a === "reread") { t.disabled = true; t.textContent = "Reading…"; try { applyAll(await gs("api_rereadSlip", D.pid)); const p = S.payslips.find(x => x.id === D.pid); toast(p && !p.needsCheck ? "Read it: " + eur(p.gross) + " gross" : "Still couldn't read it. Type the amounts in instead."); } catch (er) { toast("Couldn't read it: " + (er.message || er)); } return; }
  if (a === "fillslip") {
    const r = L.parsePayslip($("#p_raw").value), set = (i, x) => { if (x != null) $("#" + i).value = x; };
    set("q_no", r.number); set("q_d", r.payDate); set("q_g", r.gross); set("q_n", r.net); set("q_cum", r.cumulativeGross); set("q_paye", r.paye); set("q_usc", r.usc);
    return toast(r.gross != null ? "Filled in. Check the numbers before saving." : "Couldn't read that text. Fill in the fields by hand.");
  }
  if (a === "saveslip") {
    if (!dv("q_ps") || !dv("q_pe") || dn("q_g") == null) return toast("Fill in the dates it covers and the gross pay.");
    const old = S.payslips.find(x => x.id === D.pid) || { source: "manual" };
    const data = { ...strip(old), periodStart: dv("q_ps"), periodEnd: dv("q_pe"), number: dn("q_no"), payDate: dv("q_d"), gross: dn("q_g"), net: dn("q_n"), paye: dn("q_paye"), usc: dn("q_usc"), cumulativeGross: dn("q_cum"), receivedDate: dv("q_rec"), needsCheck: false };
    dlg().close(); await save("payslips", D.pid || "slip-" + uid(), data); return toast("Payslip saved");
  }
  if (a === "delslip") { if (!armDelete(t, a + D.pid)) return; dlg().close(); return remove("payslips", D.pid); }
  if (a === "pastecheck") {
    const raw = $("#raw").value, p = L.parseWeekly(raw);
    if (!p.lines.length) return toast("No lesson rows found. Paste the whole email, including the table and the Total line.");
    await save("statements", p.week.start, { week: p.week, lines: p.lines, totalHours: p.totalHours, totalAmount: p.totalAmount, raw, source: "manual", savedAt: new Date().toISOString(), resolved: false });
    const n = L.moneyIssues(p, S.students, S.lessons).length;
    return toast(`Week of ${fmtD(p.week.start)} added: ${n ? n + " pay problem" + (n > 1 ? "s" : "") : "matches your lessons"}.`);
  }
});
// Profile photo: cropped to a square and shrunk before it's saved in your Sheet
document.addEventListener("change", e => {
  if (e.target.id !== "pr_photo" || !e.target.files[0]) return;
  const f = e.target.files[0], img = new Image(), url = URL.createObjectURL(f);
  img.onload = async () => {
    const c = document.createElement("canvas"), n = 192, side = Math.min(img.width, img.height); c.width = c.height = n;
    c.getContext("2d").drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, n, n);
    URL.revokeObjectURL(url);
    try { applyAll(await gs("api_saveProfile", { photo: c.toDataURL("image/jpeg", 0.85) })); toast("Photo saved"); } catch (er) { toast("Couldn't save the photo: " + (er.message || er)); }
  };
  img.onerror = () => toast("That file isn't a picture I can read.");
  img.src = url;
});
document.addEventListener("submit", async e => {
  if (e.target.dataset.form !== "todo") return; e.preventDefault();
  const i = $("#newtodo"), text = i.value.trim(); if (!text) return;
  await save("todos", "t-" + uid(), { text, done: false, createdAt: new Date().toISOString() }); toast("Added");
});
document.addEventListener("keydown", e => { if (e.target.id === "newtodo" && e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.target.form.requestSubmit(); } });
document.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.matches("tr[data-act]")) e.target.click(); });
document.addEventListener("input", e => {
  if (!e.target.closest("#panel") || !["p_hours", "p_rate"].includes(e.target.id)) return;
  const m = panelModel(); if (!m) return;
  const amt = L.amountOf({ kind: panelKind || m.kind || "class", hours: +$("#p_hours").value, rate: +$("#p_rate").value });
  const sm = $("#panel summary"); if (sm) sm.firstChild.textContent = `Pay: ${hrs(panelKind === "cancelled" ? 0 : $("#p_hours").value)} × ${eur($("#p_rate").value)} = `;
  const b = $("#panel summary b"); if (b) b.textContent = eur(amt);
});
let tt; function toast(m, ms = 3500) { const x = $("#toast"); x.textContent = m; x.hidden = false; clearTimeout(tt); tt = setTimeout(() => x.hidden = true, ms); }

dlg().addEventListener("close", () => { sel = null; panelKind = null; });
render(); load();
