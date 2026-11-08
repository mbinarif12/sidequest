/**
 * SideQuest — Google Apps Script backend.
 * Data lives in this spreadsheet's tabs. The web page (Index.html) is served by doGet().
 * Your wages emails are checked on Mondays and Tuesdays between 9 and 10am.
 * Your Google Calendar is read whenever the page opens and during those runs.
 */

// New columns are only ever added at the END of a tab, so older sheets keep lining up.
const TABS = {
  Students: ["id", "name", "subject", "code", "weekday", "time", "hours", "rate", "pkgSize", "priorCount", "startDate", "notes", "active", "calKeyword", "ownRate"],
  Lessons: ["id", "date", "time", "studentId", "label", "kind", "hours", "rate", "number", "topic", "homework", "notes", "followups", "followupsDone", "updatedAt", "eventId", "source"],
  Statements: ["id", "weekStart", "weekEnd", "totalHours", "totalAmount", "lines", "raw", "source", "savedAt", "resolved"],
  Payslips: ["id", "number", "payDate", "periodStart", "periodEnd", "gross", "net", "cumulativeGross", "paye", "usc", "receivedDate", "pdfUrl", "needsCheck", "source", "mismatchOk", "pdfText"],
  Processed: ["messageId", "date", "subject", "type", "result"],
  Settings: ["key", "value", "about"],
  Todos: ["id", "text", "done", "createdAt", "key"],
};
const COL_TAB = { students: "Students", lessons: "Lessons", statements: "Statements", payslips: "Payslips", todos: "Todos" };
const NUM = ["weekday", "hours", "rate", "pkgSize", "priorCount", "number", "totalHours", "totalAmount", "gross", "net", "cumulativeGross", "paye", "usc", "ownRate"];
const BOOL = ["active", "followupsDone", "resolved", "needsCheck", "mismatchOk", "done"];
const JSONF = ["lines"];
const TZ = "Europe/Dublin";
const today_ = () => Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd");
const DEFAULT_SETTINGS = () => [
  ["senders", "", "Email addresses your weekly wages emails and payslips come from (comma separated)."],
  ["emailSummary", "yes", "Email yourself a short summary when something needs a look (yes / no)."],
  ["lookbackDays", "45", "How many days back each check looks for emails it hasn't seen."],
  ["payslipFolder", "SideQuest payslips", "Drive folder where payslip PDFs are saved."],
  ["calendarId", "primary", "Which Google Calendar holds your lessons. 'primary' is your main calendar; or paste a calendar ID from its settings."],
  ["autoLog", "yes", "Mark calendar lessons as taught automatically once they've ended (yes / no)."],
  ["calendarFrom", today_(), "Calendar lessons before this date are never logged automatically (your history covers them)."],
  ["teacherName", "", "Your name, used to sign emails to admin."],
  ["adminName", "", "First name of the person who sends your wages emails, used in draft emails."],
  ["rateHistory", JSON.stringify([{ from: "2020-01-01", class: 35, trial: 35, other: 20 }]), "Your rates and the date each applies from. Change them on the Profile page."],
  ["lastRun", "", "Filled in automatically."],
];
const PROFILE_KEYS = ["teacherName", "adminName", "email", "subjects", "photo", "theme", "senders", "emailSummary", "calendarId", "autoLog"];
const STATUS_KEYS = ["oldSearch", "oldSearchResult"];

// ---------- Menu & web page ----------
function onOpen() {
  SpreadsheetApp.getUi().createMenu("SideQuest")
    .addItem("Check wages emails now", "menuRunCheck")
    .addItem("Sync Google Calendar now", "menuSyncCalendar")
    .addItem("Find old payslip PDFs", "menuFindOldPayslips")
    .addSeparator()
    .addItem("Import history (one time)", "menuImportHistory")
    .addItem("Set up / repair", "menuSetup")
    .addToUi();
}
function menuSetup() { SpreadsheetApp.getUi().alert(setup()); }
function menuRunCheck() {
  const r = runCheck();
  SpreadsheetApp.getUi().alert(r.length ? r.map(x => "• " + x.result).join("\n") : "No new wages emails.");
}
function menuSyncCalendar() {
  const r = withLock_(syncCalendar_);
  SpreadsheetApp.getUi().alert(r.error ? r.error : `Logged ${r.created} lesson${r.created === 1 ? "" : "s"} from your calendar. ${r.planned.length} upcoming.` + (r.unmatched.length ? `\n\nThese events didn't match a student's calendar keyword:\n• ${r.unmatched.slice(0, 10).join("\n• ")}` : ""));
}
function menuImportHistory() { SpreadsheetApp.getUi().alert(importHistory()); }
function doGet() {
  return HtmlService.createHtmlOutputFromFile("Index")
    .setTitle("SideQuest")
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}

// ---------- Setup ----------
function setup() {
  const ss = SpreadsheetApp.getActive();
  Object.keys(TABS).forEach(name => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    const h = TABS[name];
    sh.getRange(1, 1, 1, h.length).setValues([h]).setFontWeight("bold");
    sh.setFrozenRows(1);
    sh.getRange(1, 1, sh.getMaxRows(), h.length).setNumberFormat("@"); // keep dates as plain text
  });
  const have = readRows_("Settings").map(r => r.key);
  DEFAULT_SETTINGS().filter(d => !have.includes(d[0])).forEach(d => ss.getSheetByName("Settings").appendRow(d));
  // Give students without a calendar keyword their default one
  readRows_("Students").filter(s => !s.calKeyword).forEach(s => upsert_("Students", { ...s, calKeyword: defaultKeyword_(s) }));
  if (!getSettings_().email) setSetting_("email", Session.getEffectiveUser().getEmail() || "");
  const blank = ss.getSheetByName("Sheet1"); if (blank && ss.getSheets().length > 1 && blank.getLastRow() === 0) ss.deleteSheet(blank);

  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === "runCheck").forEach(t => ScriptApp.deleteTrigger(t));
  [ScriptApp.WeekDay.MONDAY, ScriptApp.WeekDay.TUESDAY].forEach(d =>
    ScriptApp.newTrigger("runCheck").timeBased().onWeekDay(d).atHour(9).inTimezone(TZ).create());
  dedupeTodos_();
  const removed = cleanupPayslips_();
  if (removed) { try { runCheck(); } catch (e) {} } // re-read those emails as weekly statements
  readRows_("Payslips").filter(p => p.needsCheck && p.pdfUrl).forEach(p => { try { rereadSlip_(p); } catch (e) {} });
  return "Set up done. Emails are checked on Mondays and Tuesdays between 9 and 10am, and your calendar whenever you open SideQuest.";
}
function defaultKeyword_(s) { return s.name; }

// ---------- History import (History.gs) ----------
// Optional: bring in lessons and payslips from before you started using SideQuest.
// Put them in a History.gs file (see README, "Bringing in your history"). It never goes on GitHub.
function importHistory() {
  if (typeof HISTORY_LESSONS === "undefined") return "No History file found. See the README section \"Bringing in your history\".";
  return withLock_(() => {
      const sh = sheet_("Lessons"), head = headOf_(sh);
    // Remove an earlier import so this can be run again safely
    const n = sh.getLastRow();
    if (n > 1) {
      const ids = sh.getRange(2, 1, n - 1, 1).getValues().map(r => String(r[0]));
      // Also drop classes the calendar logged on days your spreadsheet already covers, so nothing is counted twice
      const rowsNow = readRows_("Lessons");
      const lastH = typeof HISTORY_LAST_DATE !== "undefined" ? HISTORY_LAST_DATE : HISTORY_LESSONS.map(l => l.date).sort().pop();
      const dup = l => l.source === "calendar" && l.date <= lastH && HISTORY_LESSONS.some(h => h.studentId === l.studentId && h.date === l.date);
      for (let i = ids.length - 1; i >= 0; i--) if (ids[i].indexOf("h-") === 0 || (rowsNow[i] && rowsNow[i].id === ids[i] && dup(rowsNow[i]))) sh.deleteRow(i + 2);
    }
    const rows = HISTORY_LESSONS.map(l => head.map(h => toCell_(h, { ...l, updatedAt: "imported" }[h])));
    if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, head.length).setNumberFormat("@").setValues(rows);
    // Past payslips: fill gaps only, never overwrite what came from your wages emails
    const slips = readRows_("Payslips");
    (typeof HISTORY_PAYSLIPS === "undefined" ? [] : HISTORY_PAYSLIPS).forEach(h => {
      const old = slips.find(s => s.periodEnd === h.periodEnd);
      if (!old) return upsert_("Payslips", h);
      const merged = { ...old }; Object.keys(h).forEach(k => { if (k !== "id" && (merged[k] == null || merged[k] === "")) merged[k] = h[k]; });
      upsert_("Payslips", merged);
    });
    // Students: lesson counts now come from the imported lesson numbers
    readRows_("Students").forEach(s => upsert_("Students", { ...s, priorCount: 0, calKeyword: s.calKeyword || defaultKeyword_(s) }));
    const last = typeof HISTORY_LAST_DATE !== "undefined" ? HISTORY_LAST_DATE : HISTORY_LESSONS.map(l => l.date).sort().pop();
    const after = L.addDays(last, 1);
    if ((getSettings_().calendarFrom || "") < after) setSetting_("calendarFrom", after);
    const total = HISTORY_LESSONS.reduce((a, l) => a + l.hours * l.rate, 0);
    return `Imported ${HISTORY_LESSONS.length} lessons (€${total.toFixed(2)}) and ${typeof HISTORY_PAYSLIPS === "undefined" ? 0 : HISTORY_PAYSLIPS.length} past payslips. Open SideQuest to see them.`;
  });
}

// ---------- Sheet storage ----------
function sheet_(name) { const sh = SpreadsheetApp.getActive().getSheetByName(name); if (!sh) throw new Error(`The "${name}" tab is missing. Run SideQuest → Set up / repair.`); return sh; }
function headOf_(sh) { return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String); }

function readRows_(name) {
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  const vals = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  const head = vals[0].map(String);
  return vals.slice(1).filter(r => String(r[0]) !== "").map(r => {
    const o = {};
    head.forEach((h, i) => { if (h) o[h] = fromCell_(h, r[i]); });
    return o;
  });
}
function fromCell_(h, v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, h === "time" ? "HH:mm" : h === "updatedAt" || h === "savedAt" ? "yyyy-MM-dd'T'HH:mm:ss" : "yyyy-MM-dd");
  if (NUM.includes(h)) return v === "" || v == null ? null : Number(v);
  if (BOOL.includes(h)) return v === true || String(v).toLowerCase() === "true";
  if (JSONF.includes(h)) { try { return v ? JSON.parse(v) : []; } catch (e) { return []; } }
  return v == null ? "" : String(v);
}
function toCell_(h, v) {
  if (v == null) return "";
  if (JSONF.includes(h)) return JSON.stringify(v);
  if (BOOL.includes(h)) return v ? "TRUE" : "FALSE";
  return String(v).slice(0, 49000);
}
function upsert_(name, obj) {
  const sh = sheet_(name), head = headOf_(sh);
  const row = head.map(h => toCell_(h, obj[h]));
  const n = sh.getLastRow();
  const ids = n > 1 ? sh.getRange(2, 1, n - 1, 1).getValues().map(r => String(r[0])) : [];
  const i = ids.indexOf(String(obj[head[0]]));
  if (i >= 0) sh.getRange(i + 2, 1, 1, row.length).setValues([row]);
  else sh.getRange(n + 1, 1, 1, row.length).setNumberFormat("@").setValues([row]);
}
function delete_(name, id) {
  const sh = sheet_(name), n = sh.getLastRow(); if (n < 2) return;
  const i = sh.getRange(2, 1, n - 1, 1).getValues().map(r => String(r[0])).indexOf(String(id));
  if (i >= 0) sh.deleteRow(i + 2);
}
const stmtOut_ = r => { const { weekStart, weekEnd, ...rest } = r; return { ...rest, week: { start: weekStart, end: weekEnd } }; };
const stmtIn_ = o => { const { week, ...rest } = o; return { ...rest, weekStart: week && week.start, weekEnd: week && week.end }; };
function getSettings_() { const o = {}; readRows_("Settings").forEach(r => o[r.key] = r.value); return o; }
function setSetting_(k, v) { upsert_("Settings", { key: k, value: v, about: ((DEFAULT_SETTINGS().find(d => d[0] === k) || [])[2]) || "" }); }

function all_() {
  return {
    students: readRows_("Students"), lessons: readRows_("Lessons"),
    statements: readRows_("Statements").map(stmtOut_), payslips: readRows_("Payslips").map(p => { const { pdfText, ...r } = p; return { ...r, hasText: !!pdfText }; }),
  };
}

// ---------- API used by the web page ----------
function withLock_(fn) {
  const l = LockService.getScriptLock();
  if (!l.tryLock(28000)) throw new Error("SideQuest is busy with another task (an email check or search). Try again in a minute.");
  try { return fn(); } finally { l.releaseLock(); }
}
function api_getAll() {
  const cal = withLock_(syncCalendar_);
  const st = getSettings_(), profile = {};
  PROFILE_KEYS.forEach(k => profile[k] = st[k] || "");
  const status = {}; STATUS_KEYS.forEach(k => status[k] = st[k] || "");
  const todos = readRows_("Todos");
  const keys = todos.filter(t => !t.done).map(t => t.key || String(t.text).trim().toLowerCase());
  if (new Set(keys).size < keys.length) withLock_(dedupeTodos_);
  return { ...all_(), todos: readRows_("Todos"), lastRun: st.lastRun || "", today: today_(), now: new Date().toISOString(), calendar: cal, profile, rates: rates_(), status };
}
function api_saveProfile(p) {
  if (p.photo && String(p.photo).length > 48000) throw new Error("That photo is too big. Try a smaller picture.");
  if (p.photo && !/^data:image\/(jpeg|png|webp);base64,/.test(p.photo)) throw new Error("That isn't a picture.");
  withLock_(() => PROFILE_KEYS.forEach(k => { if (p[k] !== undefined) setSetting_(k, String(p[k]).trim()); }));
  return api_getAll();
}
// Add a rate change from a date. With applyToLogged, classes already logged from that date that haven't been paid yet get the new rate too.
function api_setRates(r, applyToLogged) {
  withLock_(() => {
    const e = { from: String(r.from), class: +r.class, trial: +r.trial, other: +r.other };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.from) || [e.class, e.trial, e.other].some(x => !(x >= 0))) throw new Error("Rates need a start date and three amounts.");
    const list = rates_().filter(x => x.from !== e.from).concat([e]).sort((a, b) => a.from.localeCompare(b.from));
    setSetting_("rateHistory", JSON.stringify(list));
    if (applyToLogged) {
      const paidUpTo = readRows_("Payslips").filter(p => p.receivedDate).map(p => p.periodEnd).sort().pop() || "";
      const students = readRows_("Students");
      readRows_("Lessons").filter(l => l.date >= e.from && l.date > paidUpTo).forEach(l => {
        const s = students.find(x => x.id === l.studentId);
        if (s && s.ownRate) return;
        const rate = rateFor_(l.kind, l.date, null, list);
        if (rate !== l.rate) upsert_("Lessons", { ...l, rate });
      });
    }
  });
  return api_getAll();
}
function api_save(col, id, data) {
  if (!COL_TAB[col]) throw new Error("Unknown list: " + col);
  return withLock_(() => { const o = { ...data, id }; upsert_(COL_TAB[col], col === "statements" ? stmtIn_(o) : o); return true; });
}
function api_remove(col, id) { if (!COL_TAB[col]) throw new Error("Unknown list: " + col); return withLock_(() => { delete_(COL_TAB[col], id); return true; }); }
function api_runNow() { const r = runCheck(); return { results: r, data: api_getAll() }; }
function api_sync() { return api_getAll(); }
// Every event in one week (Mon–Sun), classes matched to students, for the calendar grid
function api_week(mondayISO) {
  const id = String(getSettings_().calendarId || "primary").trim();
  let cal; try { cal = id === "primary" || !id ? CalendarApp.getDefaultCalendar() : CalendarApp.getCalendarById(id); } catch (e) { return { error: "no-calendar", events: [] }; }
  if (!cal) return { error: "no-calendar", events: [] };
  const students = readRows_("Students");
  const a = new Date(mondayISO + "T00:00:00"), b = new Date(a.getTime() + 7 * 864e5 + 3 * 36e5);
  const events = cal.getEvents(new Date(a.getTime() - 3 * 36e5), b).map(ev => {
    const s = ev.isAllDayEvent() ? null : matchStudent_(ev.getTitle(), students);
    const date = Utilities.formatDate(ev.getStartTime(), TZ, "yyyy-MM-dd");
    return { key: ev.getId() + "@" + date, title: ev.getTitle(), allDay: ev.isAllDayEvent(), date,
      start: Utilities.formatDate(ev.getStartTime(), TZ, "HH:mm"), end: Utilities.formatDate(ev.getEndTime(), TZ, "HH:mm"),
      endDate: Utilities.formatDate(ev.getEndTime(), TZ, "yyyy-MM-dd"), startIso: ev.getStartTime().toISOString(), studentId: s ? s.id : "" };
  });
  return { error: "", events };
}
// Read a payslip PDF again (e.g. one the old reader couldn't make sense of)
function api_rereadSlip(id) { withLock_(() => rereadSlip_(readRows_("Payslips").find(p => p.id === id))); return api_getAll(); }

// ---------- Rates ----------
function rates_() { try { return JSON.parse(getSettings_().rateHistory || "[]"); } catch (e) { return []; } }
function rateFor_(kind, date, student, list) {
  if (student && student.ownRate) return +student.ownRate;
  const r = (list || rates_()).filter(x => x.from <= date).sort((a, b) => a.from.localeCompare(b.from)).pop() || { class: 35, trial: 35, other: 20 };
  return kind === "demo" ? r.trial : ["meeting", "reports", "prep", "other"].indexOf(kind) >= 0 ? r.other : r.class;
}

// ---------- Google Calendar ----------
// Each student has a calendar keyword (one or more words). An event counts as that student's lesson
// when its title contains every word; if several students match, the one with the most words wins.
function matchStudent_(title, students) {
  const t = String(title || "").toLowerCase();
  const act = students.filter(s => s.active);
  // 1) a course code in the title (e.g. "IE1042 - Applied Maths G12 - Sadhbh")
  const byCode = act.find(s => s.code && new RegExp("\\b" + String(s.code).toLowerCase() + "\\b").test(t));
  if (byCode) return byCode;
  // 2) every word of the student's calendar keyword (name, plus subject when a student has two classes); most words wins
  let best = null, bestN = 0;
  act.forEach(s => {
    const words = String(s.calKeyword || s.name || "").toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length && words.every(w => t.indexOf(w) >= 0) && words.length > bestN) { best = s; bestN = words.length; }
  });
  return best;
}

function syncCalendar_() {
  const out = { created: 0, updated: 0, planned: [], unmatched: [], orphans: [], error: "" };
  let cal;
  try {
    const id = String(getSettings_().calendarId || "primary").trim();
    cal = id === "primary" || !id ? CalendarApp.getDefaultCalendar() : CalendarApp.getCalendarById(id);
    if (!cal) { out.error = "Couldn't find that calendar. Check the calendar setting on your Profile page."; return out; }
  } catch (e) { out.error = "SideQuest can't read your calendar yet. Run SideQuest → Set up / repair once to allow it."; return out; }

  const st = getSettings_(), now = new Date(), autoLog = String(st.autoLog || "yes").toLowerCase() !== "no";
  const from = st.calendarFrom || today_();
  const start = new Date(Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10)) - 864e5);
  const end = new Date(now.getTime() + 60 * 864e5);
  const students = readRows_("Students"), lessons = readRows_("Lessons");
  const seenTitle = {}, liveKeys = {};
  let events;
  try { events = cal.getEvents(start, end); } catch (e) { out.error = "Couldn't read your calendar: " + e.message; return out; }
  events.forEach(ev => {
    if (ev.isAllDayEvent()) return;
    const title = ev.getTitle(), s = matchStudent_(title, students);
    const date = Utilities.formatDate(ev.getStartTime(), TZ, "yyyy-MM-dd");
    if (!s) { if (!seenTitle[title]) { seenTitle[title] = 1; out.unmatched.push(title); } return; }
    // One key per event per day: a recurring series shares an id, and moving a class to another day makes it a new class.
    const key = ev.getId() + "@" + date;
    liveKeys[key] = 1;
    const time = Utilities.formatDate(ev.getStartTime(), TZ, "HH:mm");
    const hours = Math.round((ev.getEndTime() - ev.getStartTime()) / 9e5) / 4 || s.hours || 1;
    const sameEvent = l => l.eventId === key || (l.eventId && l.eventId.indexOf(ev.getId() + "@") === 0 && l.date === date);
    const linked = lessons.find(sameEvent) || lessons.find(l => !l.eventId && l.studentId === s.id && l.date === date && l.kind !== "cancelled");
    if (ev.getStartTime() > now) {
      out.planned.push({ eventId: key, studentId: s.id, date, time, hours, start: ev.getStartTime().toISOString(), title, lessonId: linked ? linked.id : "" });
      return;
    }
    if (date < from) return;
    if (linked) {
      const upd = { ...linked };
      if (upd.eventId !== key) upd.eventId = key;
      // Class moved earlier or later the same day: follow the calendar unless you've already written it up
      if (upd.source === "calendar" && !upd.topic && !upd.notes && (upd.time !== time || (upd.kind === "class" && upd.hours !== hours))) { upd.time = time; if (upd.kind === "class") upd.hours = hours; out.updated++; }
      if (JSON.stringify(upd) !== JSON.stringify(linked)) { upsert_("Lessons", upd); Object.assign(linked, upd); }
      return;
    }
    if (ev.getEndTime() > now) { out.planned.push({ eventId: key, studentId: s.id, date, time, hours, start: ev.getStartTime().toISOString(), title, lessonId: "", started: true }); return; }
    if (!autoLog) { out.planned.push({ eventId: key, studentId: s.id, date, time, hours, start: ev.getStartTime().toISOString(), title, lessonId: "", past: true }); return; }
    const l = {
      id: "cal-" + Utilities.getUuid().slice(0, 8), date, time, studentId: s.id, label: "", kind: "class",
      hours, rate: rateFor_("class", date, s), number: nextNumber_(s, lessons), topic: "", homework: "", notes: "",
      followups: "", followupsDone: false, updatedAt: new Date().toISOString(), eventId: key, source: "calendar",
    };
    upsert_("Lessons", l); lessons.push(l); out.created++;
  });
  // Classes logged from the calendar whose event has since been deleted or moved to another day
  out.orphans = lessons.filter(l => l.eventId && l.eventId !== "kept" && l.date >= from && new Date(l.date + "T00:00:00Z") >= start && new Date(l.date + "T00:00:00Z") < end && !liveKeys[l.eventId] && l.kind !== "cancelled").map(l => l.id);
  out.planned.sort((a, b) => a.start.localeCompare(b.start));
  return out;
}
function nextNumber_(s, lessons) {
  const ls = lessons.filter(l => l.studentId === s.id && l.kind === "class").sort((a, b) => a.date.localeCompare(b.date));
  let i = ls.length - 1; while (i >= 0 && !(+ls[i].number > 0)) i--;
  const done = i >= 0 ? +ls[i].number + (ls.length - 1 - i) : ls.length;
  return s.pkgSize && done >= s.pkgSize ? 1 : done + 1; // a finished package starts a new one
}

// ---------- Email check ----------
function runCheck() {
  return withLock_(() => {
    try { syncCalendar_(); } catch (e) {} // log calendar lessons first, so emails are compared with them
    readRows_("Payslips").filter(p => p.needsCheck && p.pdfUrl).forEach(p => { try { rereadSlip_(p); } catch (e) {} });
    const st = getSettings_();
    const senders = String(st.senders || "").split(/[,\s]+/).filter(Boolean).map(s => s.toLowerCase());
    if (!senders.length) { setSetting_("lastRun", new Date().toISOString()); return [{ type: "other", result: "Add the address your wages emails come from on the Profile page." }]; }
    const query = "(" + senders.map(s => "from:" + s).join(" OR ") + ") newer_than:" + (+st.lookbackDays || 45) + "d";
    const seen = new Set(readRows_("Processed").map(r => r.messageId));
    const msgs = [];
    GmailApp.search(query, 0, 100).forEach(th => th.getMessages().forEach(m => {
      if (seen.has(m.getId())) return;
      const from = m.getFrom().toLowerCase();
      if (senders.some(s => from.includes(s))) msgs.push(m);
    }));
    msgs.sort((a, b) => a.getDate() - b.getDate());
    const results = [];
    msgs.forEach(m => {
      let r;
      try { r = handleMessage_(m); } catch (e) { r = { type: "error", result: `Couldn't read "${m.getSubject()}": ${e.message}` }; }
      if (r.type !== "error") upsert_("Processed", { messageId: m.getId(), date: Utilities.formatDate(m.getDate(), TZ, "yyyy-MM-dd HH:mm"), subject: m.getSubject(), type: r.type, result: r.result });
      if (r.type !== "other") results.push(r);
    });
    setSetting_("lastRun", new Date().toISOString());
    const worth = results.filter(r => r.type === "payslip" || r.type === "error" || (r.issues || []).length);
    if (worth.length && String(st.emailSummary || "yes").toLowerCase() !== "no") sendSummary_(worth);
    return results.map(r => ({ type: r.type, result: r.result }));
  });
}

function handleMessage_(m) {
  const body = m.getPlainBody() || "";
  // A weekly wages table wins: those emails often sit in a payslip thread and quote its text.
  const p = L.parseWeekly(body);
  if (p.lines.length) return handleWeekly_(m, p, body);
  // A payslip only counts when its PDF is attached
  const pdf = m.getAttachments({ includeInlineImages: false }).find(a => /pdf/i.test(a.getContentType()) || /\.pdf$/i.test(a.getName()));
  if (pdf && /payslip/i.test(pdf.getName())) return handlePayslip_(m, body, pdf); // the PDF itself must be a payslip (not a contract that mentions one)
  return { type: "other", result: "Not a wages email." };
}

function handleWeekly_(m, p, body) {
  const old = readRows_("Statements").find(s => s.id === p.week.start);
  const stmt = { id: p.week.start, week: p.week, lines: p.lines, totalHours: p.totalHours, totalAmount: p.totalAmount, raw: body.slice(0, 20000), source: "email", savedAt: new Date().toISOString(), resolved: old ? old.resolved : false };
  upsert_("Statements", stmtIn_(stmt));
  const d = all_();
  const issues = L.moneyIssues(p, d.students, d.lessons).map(i => i.text);
  const total = L.internalChecks(p).sumA;
  return {
    type: "weekly", issues,
    result: `Week of ${p.week.start}: €${total.toFixed(2)} from admin, ${issues.length ? issues.length + " pay problem" + (issues.length > 1 ? "s" : "") : "matches your lessons"}.`,
  };
}

function handlePayslip_(m, body, pdf) {
  let period = L.parsePeriod(body, m.getDate().getFullYear());
  const st = getSettings_();
  let parsed = {}, pdfUrl = "";
  const known = readRows_("Payslips").find(s => period && s.periodEnd === period.end && s.pdfUrl);
  if (pdf && known) { pdfUrl = known.pdfUrl; try { parsed = L.parsePayslip(pdfText_(pdf.copyBlob()), expectedGross_(period.start, period.end)); } catch (e) { parsed = {}; } }
  else if (pdf) {
    const folderName = st.payslipFolder || "SideQuest payslips";
    const it = DriveApp.getFoldersByName(folderName);
    const folder = it.hasNext() ? it.next() : DriveApp.createFolder(folderName);
    const saved = folder.createFile(pdf.copyBlob().setName(pdf.getName()));
    pdfUrl = saved.getUrl();
    try { const txt = pdfText_(pdf.copyBlob()); parsed = L.parsePayslip(txt, expectedGross_(period && period.start, period && period.end)); parsed.pdfText = txt.slice(0, 20000); } catch (e) { parsed = { pdfText: "Couldn't convert: " + e.message }; }
  }
  // Match by period, else by pay date. (The number on a Sage payslip is your employee number: the same every month.)
  const slips = readRows_("Payslips");
  const fm = pdf ? pdf.getName().match(/(\d{2})-(\d{2})-(\d{4})/) : null, payDate = (fm ? `${fm[3]}-${fm[2]}-${fm[1]}` : "") || parsed.payDate || ""; // the date in the file name is the most reliable
  let old = slips.find(s => period && s.periodEnd === period.end) || slips.find(s => payDate && s.payDate === payDate)
    || slips.find(s => payDate && s.payDate && s.payDate.slice(0, 7) === payDate.slice(0, 7));
  if (!period && old && old.periodEnd) period = { start: old.periodStart, end: old.periodEnd };
  if (!period && payDate) { const p = L.periodOfMonth(+payDate.slice(0, 4), +payDate.slice(5, 7) - 1); period = { start: p.start, end: p.end }; } // "Salary of August": the August period
  const periodEnd = period ? period.end : "";
  const slip = {
    id: old ? old.id : "slip-" + (periodEnd || Utilities.getUuid().slice(0, 8)),
    number: null, payDate, periodStart: period ? period.start : "", periodEnd,
    gross: parsed.gross, net: parsed.net, cumulativeGross: parsed.cumulativeGross, paye: parsed.paye, usc: parsed.usc,
    receivedDate: "", pdfUrl, source: "email", pdfText: parsed.pdfText || "",
  };
  if (old) Object.keys(slip).forEach(k => { if (slip[k] == null || slip[k] === "") slip[k] = old[k]; });
  slip.needsCheck = slip.gross == null || !slip.periodStart;
  upsert_("Payslips", slip);
  const name = slip.periodEnd ? L.periodName(slip.periodStart, slip.periodEnd) : "";
  return {
    type: "payslip", issues: slip.needsCheck ? ["Some amounts couldn't be read from the PDF. Open Payslips in SideQuest and fill them in."] : [],
    result: `${name || "New"} payslip: ${slip.gross != null ? "€" + (+slip.gross).toFixed(2) + " gross" : "amounts not read yet"}${slip.net != null ? ", €" + (+slip.net).toFixed(2) + " to you" : ""}.`,
  };
}

// Earlier versions could create the same package reminder many times. Keep the first of each.
function dedupeTodos_() {
  const seen = {}, rows = readRows_("Todos").sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  rows.forEach(t => { const k = (t.key || String(t.text).trim().toLowerCase()) + (t.done ? "|done" : ""); if (seen[k]) delete_("Todos", t.id); else seen[k] = 1; });
}

// Earlier versions mistook weekly emails that quote a payslip email for payslips. Remove those empty entries
// and forget those emails, so the next check reads them again as weekly statements.
function cleanupPayslips_() {
  const bad = readRows_("Payslips").filter(p => p.source === "email" && p.gross == null && (!p.pdfUrl || !p.periodEnd));
  bad.forEach(p => delete_("Payslips", p.id));
  const pr = readRows_("Processed").filter(r => r.type === "payslip" && /amounts not read yet/.test(r.result));
  pr.forEach(r => delete_("Processed", r.messageId));
  return bad.length;
}

// One-time search of ALL past wages emails for payslip PDFs, so older months get their PDF too.
// Search ALL past emails for payslip PDFs, so older months get their PDF too.
// Works in batches (about 4 minutes each) without holding the app's lock; press the button again to carry on.
function findOldPayslips_() {
  const started = Date.now(), budget = 4 * 60 * 1000; // web calls are limited to 6 minutes
  withLock_(cleanupPayslips_);
  const st = getSettings_();
  const senders = String(st.senders || "").split(/[,\s]+/).filter(Boolean).map(s => s.toLowerCase());
  // Any email with a payslip PDF, whoever sent it (older payslips sometimes come from a different admin address)
  // Only emails whose attachment is called "payslip…", plus PDFs from your wages senders. Narrow = fast.
  const queries = ["has:attachment filename:payslip"].concat(senders.length ? ["has:attachment filename:pdf (" + senders.map(s => "from:" + s).join(" OR ") + ")"] : []);
  const res = { found: 0, linked: 0, added: 0, months: [], already: [], more: false, emails: 0, problems: [] };
  const checked = new Set(readRows_("Processed").filter(r => r.type === "oldslip" || r.type === "payslip").map(r => r.messageId));
  const done = {};
  const seenTh = {}, threads = [];
  queries.forEach(q => GmailApp.search(q, 0, 200).forEach(th => { if (!seenTh[th.getId()]) { seenTh[th.getId()] = 1; threads.push(th); } }));
  for (const th of threads) {
    for (const m of th.getMessages()) {
      if (done[m.getId()]) continue; done[m.getId()] = 1; res.emails++;
      if (Date.now() - started > budget) { res.more = true; break; }
      try {
      const body = m.getPlainBody() || "";
      const pdf = m.getAttachments({ includeInlineImages: false }).find(a => (/pdf/i.test(a.getContentType()) || /\.pdf$/i.test(a.getName())) && /payslip/i.test(a.getName()));
      if (!pdf) continue;
      res.found++;
      const period = L.parsePeriod(body, m.getDate().getFullYear());
      const fm = pdf.getName().match(/(\d{2})-(\d{2})-(\d{4})/), fileDate = fm ? `${fm[3]}-${fm[2]}-${fm[1]}` : "";
      const slips = readRows_("Payslips");
      let slip = slips.find(s => period && s.periodEnd === period.end) || slips.find(s => fileDate && s.payDate === fileDate)
        || slips.find(s => fileDate && s.payDate && s.payDate.slice(0, 7) === fileDate.slice(0, 7));
      const label = period ? L.periodName(period.start, period.end) : fileDate ? L.MONTHS[+fileDate.slice(5, 7) - 1] + " payslip" : pdf.getName();
      if (slip && slip.pdfUrl) { res.already.push(label); continue; }
      // Only convert the PDF to text when the month is missing (or missing its amounts): it's the slow part
      let txt = "", parsed = {};
      if (!slip || slip.gross == null || slip.net == null) {
        try { txt = pdfText_(pdf.copyBlob()); parsed = L.parsePayslip(txt, period ? expectedGross_(period.start, period.end) : null); } catch (e) {}
        if (!slip && parsed.payDate) slip = slips.find(s => s.payDate === parsed.payDate);
      }
      res.months.push(label);
      withLock_(() => {
        if (!slip) { handlePayslip_(m, body, pdf); res.added++; }
        else {
          const folderName = st.payslipFolder || "SideQuest payslips";
          const it = DriveApp.getFoldersByName(folderName);
          const folder = it.hasNext() ? it.next() : DriveApp.createFolder(folderName);
          const upd = { ...slip, pdfUrl: folder.createFile(pdf.copyBlob().setName(pdf.getName())).getUrl() };
          if (txt) upd.pdfText = txt.slice(0, 20000);
          const payDate = parsed.payDate || fileDate;
          if (!upd.payDate && payDate) upd.payDate = payDate;
          ["gross", "net", "cumulativeGross", "paye", "usc"].forEach(k => { if ((upd[k] == null || upd[k] === "") && parsed[k] != null) upd[k] = parsed[k]; });
          if (period && !upd.periodStart) upd.periodStart = period.start;
          upd.needsCheck = upd.gross == null;
          upsert_("Payslips", upd); res.linked++;
        }
        upsert_("Processed", { messageId: m.getId(), date: Utilities.formatDate(m.getDate(), TZ, "yyyy-MM-dd HH:mm"), subject: m.getSubject(), type: "oldslip", result: "Payslip PDF found: " + label });
      });
      } catch (e) { res.problems.push(`"${m.getSubject()}": ${e.message}`); }
    }
    if (res.more) break;
  }
  if (!res.more) setSetting_("oldPayslipsSearched", new Date().toISOString());
  return res;
}
// The button runs the search straight away (it only looks at a handful of emails). If it runs out of time,
// the rest carries on in the background and the Payslips page shows the result.
function api_findOldPayslips() {
  let r;
  try { r = findOldPayslips_(); }
  catch (e) { setSetting_("oldSearch", "error|" + new Date().toISOString() + "|" + e.message); return { result: null, error: e.message, data: api_getAll() }; }
  setSetting_("oldSearchResult", JSON.stringify({ found: r.found, months: r.months, already: r.already, emails: r.emails, problems: r.problems, partial: r.more }));
  if (r.more) { setSetting_("oldSearch", "running|" + new Date().toISOString()); ScriptApp.newTrigger("oldPayslipsJob").timeBased().after(1000).create(); }
  else setSetting_("oldSearch", "done|" + new Date().toISOString());
  return { result: r, data: api_getAll() };
}
function oldPayslipsJob() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === "oldPayslipsJob").forEach(t => ScriptApp.deleteTrigger(t));
  let r;
  try { r = findOldPayslips_(); } catch (e) { setSetting_("oldSearch", "error|" + new Date().toISOString() + "|" + e.message); return; }
  const prev = (() => { try { return JSON.parse(getSettings_().oldSearchResult || "{}"); } catch (e) { return {}; } })();
  const keep = /^running/.test(getSettings_().oldSearch || "") && prev.partial ? prev : { found: 0, months: [], already: [] };
  const merged = { found: (keep.found || 0) + r.found, months: [...new Set([...(keep.months || []), ...r.months])], already: [...new Set([...(keep.already || []), ...r.already])], partial: r.more };
  setSetting_("oldSearchResult", JSON.stringify(merged));
  if (r.more) { setSetting_("oldSearch", "running|" + new Date().toISOString()); ScriptApp.newTrigger("oldPayslipsJob").timeBased().after(1000).create(); }
  else setSetting_("oldSearch", "done|" + new Date().toISOString());
}
function menuFindOldPayslips() { const r = findOldPayslips_(); SpreadsheetApp.getUi().alert(`Found ${r.found} payslip PDF${r.found === 1 ? "" : "s"} in your email. Added: ${r.months.join(", ") || "none"}. Already had: ${r.already.join(", ") || "none"}.${r.more ? " There's more: run it again to carry on." : ""}`); }

// What this period's payslip should say: your lessons, else admin's weekly emails. Helps the reader pick the right numbers.
function expectedGross_(start, end) {
  if (!end) return null;
  if (!start) { const p = L.periodFor(end); start = p.start; }
  const ls = readRows_("Lessons").filter(l => l.date >= start && l.date <= end && l.kind !== "cancelled");
  if (ls.length) return L.round2(ls.reduce((a, l) => a + L.amountOf(l), 0));
  const st = readRows_("Statements").map(stmtOut_).filter(x => x.week && x.week.start >= start && x.week.start <= end);
  return st.length ? L.round2(st.reduce((a, x) => a + (x.lines || []).reduce((b, l) => b + l.subtotal, 0), 0)) : null;
}
function rereadSlip_(slip) {
  if (!slip || !slip.pdfUrl) return false;
  const m = String(slip.pdfUrl).match(/\/d\/([A-Za-z0-9_-]+)/); if (!m) return false;
  const txt = pdfText_(DriveApp.getFileById(m[1]).getBlob());
  const p = L.parsePayslip(txt, expectedGross_(slip.periodStart, slip.periodEnd));
  const upd = { ...slip, pdfText: txt.slice(0, 20000) };
  ["gross", "net", "cumulativeGross", "paye", "usc"].forEach(k => { if (p[k] != null) upd[k] = p[k]; });
  if (!upd.payDate && p.payDate) upd.payDate = p.payDate;
  upd.needsCheck = upd.gross == null;
  upsert_("Payslips", upd);
  return !upd.needsCheck;
}

// Convert a PDF to text through Google Drive (needs the Drive API service, see appsscript.json)
function pdfText_(blob) {
  if (typeof Drive === "undefined") return "";
  const f = Drive.Files.create({ name: "payledger-temp-" + Date.now(), mimeType: MimeType.GOOGLE_DOCS }, blob);
  try { return DocumentApp.openById(f.id).getBody().getText(); }
  finally { DriveApp.getFileById(f.id).setTrashed(true); }
}

function sendSummary_(results) {
  const to = Session.getEffectiveUser().getEmail();
  if (!to) return;
  const n = results.reduce((a, r) => a + (r.issues || []).length, 0);
  let url = ""; try { url = ScriptApp.getService().getUrl() || ""; } catch (e) {}
  const lines = results.slice(0, 15).map(r => "• " + r.result + ((r.issues || []).length ? "\n" + r.issues.slice(0, 12).map(i => "   – " + i).join("\n") : ""));
  MailApp.sendEmail(to, `SideQuest: ${n ? n + " thing" + (n > 1 ? "s" : "") + " to look at" : "new payslip"}`,
    lines.join("\n\n") + (url ? `\n\nOpen SideQuest: ${url}` : ""));
}
