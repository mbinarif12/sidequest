// Runs the Apps Script code in Node against fake Google services (Sheets, Gmail, Calendar, Drive),
// using invented data only. Run: node test/server.test.js
const fs = require("fs"), vm = require("vm"), assert = require("assert"), path = require("path");
const dist = path.join(__dirname, "..", "dist");
const T = s => console.log("✓ " + s);
const demo = require("./demo.js");

// ---- Fake spreadsheet ----
function makeSheet() {
  const data = [];
  const sh = {
    getLastRow: () => data.length, getLastColumn: () => Math.max(0, ...data.map(r => r.length)), getMaxRows: () => 1000,
    getRange: (r, c, nr = 1, nc = 1) => ({
      getValues: () => [...Array(nr)].map((_, i) => [...Array(nc)].map((_, j) => (data[r - 1 + i] || [])[c - 1 + j] ?? "")),
      setValues(v) { v.forEach((row, i) => { data[r - 1 + i] = data[r - 1 + i] || []; row.forEach((x, j) => data[r - 1 + i][c - 1 + j] = x); }); return this; },
      setNumberFormat() { return this; }, setFontWeight() { return this; },
    }),
    setFrozenRows() {}, appendRow: row => data.push(row), deleteRow: i => data.splice(i - 1, 1),
  };
  return sh;
}
const sheets = {};
// ---- Fake Gmail / Drive / Calendar ----
const weekly = fs.readFileSync(path.join(__dirname, "fixtures/weekly-email.txt"), "utf8");
const slipText = fs.readFileSync(path.join(__dirname, "fixtures/payslip-scrambled.txt"), "utf8");
const pdf = name => ({ getContentType: () => "application/pdf", getName: () => name, copyBlob() { return { setName() { return this; } }; } });
const msg = (id, subject, body, atts, date) => ({ getId: () => id, getFrom: () => "Admin <admin@example.com>", getSubject: () => subject, getPlainBody: () => body, getAttachments: () => atts, getDate: () => new Date(date) });
const slipBody = "Hi Alex,\nPlease find the payslip of Sep 2026 attached which includes 4 weeks' wages\nfrom 31 August to 27 September 2026.";
const messages = [
  msg("m1", "Payslip Sep 2026", slipBody, [pdf("Payslip 12 (30-09-2026).pdf")], "2026-10-12T10:00:00Z"),
  msg("m2", "Weekly wages of 12-18 Oct 2026", weekly, [], "2026-10-25T17:00:00Z"),
  msg("m3", "Re: Payslip Sep 2026", weekly.replace("12-18 Oct", "12-18 Oct") + "\n> Please find the payslip of Sep 2026 attached", [], "2026-10-26T09:00:00Z"),
];
const ev = (id, title, s, e, allDay = false) => ({ getId: () => id, getTitle: () => title, getStartTime: () => new Date(s), getEndTime: () => new Date(e), isAllDayEvent: () => allDay });
const now = Date.now(), iso = ms => new Date(ms).toISOString();
const events = [
  ev("c1", "IE1042 - G12 Maths - Sadhbh", iso(now - 3 * 36e5), iso(now - 1.5 * 36e5)),      // ended → auto-logged
  ev("c2", "Tom - G12 Applied Maths", iso(now + 48 * 36e5), iso(now + 49.5 * 36e5)),        // upcoming, matched by name
  ev("c3", "Lunch", iso(now + 24 * 36e5), iso(now + 25 * 36e5)),                            // not a class
];
const fmt = (d, tz, f) => { const z = n => String(n).padStart(2, "0"); const Y = d.getUTCFullYear(), M = z(d.getUTCMonth() + 1), D = z(d.getUTCDate()), h = z(d.getUTCHours()), m = z(d.getUTCMinutes());
  return f === "HH:mm" ? `${h}:${m}` : f === "yyyy-MM-dd" ? `${Y}-${M}-${D}` : `${Y}-${M}-${D} ${h}:${m}`; };
const ctx = {
  console, SpreadsheetApp: { getActive: () => ({ getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = makeSheet()), getSheets: () => Object.values(sheets), deleteSheet() {} }), getUi: () => ({}) },
  GmailApp: { search: () => [{ getMessages: () => messages }] },
  CalendarApp: { getDefaultCalendar: () => ({ getEvents: (a, b) => events.filter(e => e.getStartTime() >= a && e.getStartTime() < b) }), getCalendarById: () => null },
  MailApp: { sendEmail() {} }, Session: { getEffectiveUser: () => ({ getEmail: () => "alex@example.com" }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, tryLock: () => true, releaseLock() {} }) },
  Utilities: { formatDate: fmt, getUuid: () => Math.random().toString(16).slice(2) },
  ScriptApp: { getProjectTriggers: () => [], deleteTrigger() {}, WeekDay: { MONDAY: 1, TUESDAY: 2 }, newTrigger: () => { const t = { timeBased: () => t, onWeekDay: () => t, atHour: () => t, inTimezone: () => t, create() {} }; return t; }, getService: () => ({ getUrl: () => "" }) },
  DriveApp: { getFoldersByName: () => ({ hasNext: () => false }), createFolder: () => ({ createFile: () => ({ getUrl: () => "https://drive.google.com/file/d/X/view" }) }), getFileById: () => ({ setTrashed() {}, getBlob: () => ({}) }) },
  Drive: { Files: { create: () => ({ id: "d" }) } }, DocumentApp: { openById: () => ({ getBody: () => ({ getText: () => slipText }) }) }, MimeType: { GOOGLE_DOCS: "doc" },
};
vm.createContext(ctx);
vm.runInContext(["Logic.js", "Code.js"].map(f => fs.readFileSync(path.join(dist, f), "utf8")).join("\n") +
  "\nthis.__ = { setup, runCheck, api_getAll, api_save, api_week, findOldPayslips_, setSetting_, readRows_, upsert_, L };", ctx);
const G = ctx.__;

G.setup();
let d = G.api_getAll();
assert.strictEqual(d.students.length, 0); T("a fresh install starts empty: no one else's data");
assert.strictEqual(G.runCheck()[0].result, "Add the address your wages emails come from on the Profile page."); T("email checks wait until you set where wages emails come from");
demo.students.forEach(s => G.api_save("students", s.id, s));
demo.lessons.filter(l => l.source === "history").forEach(l => G.api_save("lessons", l.id, l));
G.setSetting_("senders", "admin@example.com"); G.setSetting_("calendarFrom", "2026-11-01");
d = G.api_getAll();
const auto = d.lessons.find(l => l.source === "calendar");
assert(auto && auto.studentId === "sadhbh" && auto.hours === 1.5); T("calendar: a class that has ended is logged automatically (matched by course code)");
assert(d.calendar.planned.some(p => p.studentId === "tom")); T("calendar: upcoming class matched by name");
assert(d.calendar.unmatched.includes("Lunch")); T("calendar: everyday events are left alone");

const r = G.runCheck();
d = G.api_getAll();
const sep = d.payslips.find(p => p.periodEnd === "2026-09-27");
assert.strictEqual(sep.gross, 892.5); assert.strictEqual(sep.net, 911); assert.strictEqual(sep.cumulativeGross, 3010.25); T("payslip PDF read even with scrambled text: gross, net and year-to-date");
assert.strictEqual(d.payslips.length, 1); T("a weekly email that quotes a payslip email is not mistaken for a payslip");
const st = d.statements.find(s => s.id === "2026-10-12");
const iss = G.L.moneyIssues({ week: st.week, lines: st.lines, totalHours: st.totalHours, totalAmount: st.totalAmount }, d.students, d.lessons);
assert(iss.some(i => /Darragh: hours: you logged 1 h, admin paid 0.5 h/.test(i.text)), JSON.stringify(iss)); T("weekly email: the underpaid line (Darragh, 0.5 h instead of 1 h) is caught");
assert(!iss.some(i => /Row 3|lesson count/.test(i.text))); T("weekly email: cosmetic glitches (missing row number, lesson counters) are not reported as pay problems");

const fo = G.findOldPayslips_();
assert(fo.found >= 1 && !fo.more && fo.already.includes("September")); T("old payslip search runs without blocking and reports months it already has");
const P = G.L.buildPeriods("2026-09-01", "2026-11-20", [{ periodStart: "2026-08-31", periodEnd: "2026-09-27" }, { periodStart: "2026-09-28", periodEnd: "2026-11-01" }]);
assert.strictEqual(P.find(p => p.name === "October").weeks, 5); assert.strictEqual(P.find(p => p.name === "November").start, "2026-11-02"); T("pay periods: a 5-week payslip moves the boundary, the rest follow");
assert.strictEqual(G.L.periodFor("2026-10-31").name, "November"); T("pay periods: a week counts in the month its Sunday falls in");
// Same student taking two subjects: admin's line has a course code SideQuest doesn't know yet
{
  const st2 = [{ id: "ella-m", name: "Ella", subject: "G12 Maths (H)", code: "IE5001" }, { id: "ella-a", name: "Ella", subject: "G12 Applied Maths (H)", code: "" }];
  const ls2 = [{ id: "x1", studentId: "ella-a", date: "2026-11-01", hours: 1, rate: 35, kind: "class" }, { id: "x2", studentId: "ella-a", date: "2026-11-01", hours: 1, rate: 35, kind: "class" }];
  const ln = n => ({ row: n, label: `Lesson(20)-${n} IE5002 Ella 1v1G12AppliedMaths 1v1 Class`, code: "IE5002", date: "2026-11-01", hours: 1, rate: 35, subtotal: 35, duration: 1 });
  assert.strictEqual(G.L.moneyIssues({ week: { start: "2026-10-26", end: "2026-11-01" }, lines: [ln(1), ln(2)] }, st2, ls2).length, 0);
  T("a student taking two subjects: admin's lines match the right subject, no false problems");
  const wrongCode = n => ({ ...ln(n), code: "IE5001", label: `Lesson(20)-${n} IE5001 Ella 1v1G12AppliedMaths 1v1 Class` });
  assert.strictEqual(G.L.moneyIssues({ week: { start: "2026-10-26", end: "2026-11-01" }, lines: [wrongCode(1), wrongCode(2)] }, st2, ls2).length, 0);
  T("…even when admin puts the other subject's course code on the line");
}
console.log("\nall server checks pass");
