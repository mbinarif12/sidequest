// Runs the Apps Script code in Node against fake Google services (Sheets, Gmail, Calendar, Drive),
// using invented data only. Run: node test/server.test.js
const fs = require("fs"), vm = require("vm"), assert = require("assert"), path = require("path");
const dist = path.join(__dirname, "..", "dist");
const T = s => console.log("✓ " + s);
const made = [];
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
      clearContent() { for (let i = 0; i < nr; i++) if (data[r - 1 + i]) for (let j = 0; j < nc; j++) data[r - 1 + i][c - 1 + j] = ""; return this; },
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
  ev("c4", "Applied Math Trial Class", iso(now + 26 * 36e5), iso(now + 26.5 * 36e5)),       // trial coming up, no student yet
  ev("c5", "Parent meeting - Leah", iso(now - 2 * 36e5), iso(now - 2 * 36e5 + 15 * 6e4)),   // ended meeting naming a student
  ev("c6", "Applied Math / Math Demo", iso(now - 5 * 36e5), iso(now - 4.5 * 36e5)),         // ended trial
  ev("c7", "PTM Tom", iso(now - 48 * 36e5), iso(now - 47.75 * 36e5)),                        // logged as a class by an older version
];
const fmt = (d, tz, f) => { const z = n => String(n).padStart(2, "0"); const Y = d.getUTCFullYear(), M = z(d.getUTCMonth() + 1), D = z(d.getUTCDate()), h = z(d.getUTCHours()), m = z(d.getUTCMinutes());
  return f === "HH:mm" ? `${h}:${m}` : f === "yyyy-MM-dd" ? `${Y}-${M}-${D}` : `${Y}-${M}-${D} ${h}:${m}`; };
const ctx = {
  console, SpreadsheetApp: { getActive: () => ({ getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = makeSheet()), getSheets: () => Object.values(sheets), deleteSheet() {} }), getUi: () => ({}) },
  GmailApp: { search: () => [{ getId: () => "t1", getMessages: () => messages }] },
  CalendarApp: { getDefaultCalendar: () => ({ getEvents: (a, b) => events.filter(e => e.getStartTime() >= a && e.getStartTime() < b) }), getCalendarById: () => null },
  MailApp: { sendEmail() {} }, Session: { getEffectiveUser: () => ({ getEmail: () => "alex@example.com" }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, tryLock: () => true, releaseLock() {} }) },
  Utilities: { formatDate: fmt, getUuid: () => Math.random().toString(16).slice(2), base64Decode: b => Buffer.from(b, "base64"), newBlob: (bytes, type, name) => ({ getName: () => name, copyBlob() { return { setName() { return this; } }; } }) },
  ScriptApp: { getProjectTriggers: () => [], deleteTrigger() {}, WeekDay: { MONDAY: 1, TUESDAY: 2 }, newTrigger: h => { const t = { timeBased: () => t, onWeekDay: () => t, atHour: () => t, inTimezone: () => t, after: () => t, create() { made.push(h); } }; return t; }, getService: () => ({ getUrl: () => "" }) },
  DriveApp: { getFoldersByName: () => ({ hasNext: () => false }), createFolder: () => ({ createFile: () => ({ getUrl: () => "https://drive.google.com/file/d/X/view" }) }), getFileById: () => ({ setTrashed() {}, getBlob: () => ({}) }) },
  Drive: { Files: { create: () => ({ id: "d" }) } }, DocumentApp: { openById: () => ({ getBody: () => ({ getText: () => slipText }) }) }, MimeType: { GOOGLE_DOCS: "doc" },
};
vm.createContext(ctx);
// The same checks run against the single Code.gs that people paste in by hand (npm test runs both)
const files = process.env.SQ_RELEASE ? [path.join(__dirname, "..", "release", "Code.gs")] : ["Logic.js", "Code.js"].map(f => path.join(dist, f));
vm.runInContext(files.map(f => fs.readFileSync(f, "utf8")).join("\n") +
  "\nthis.__ = { setup, runCheck, api_getAll, api_save, api_week, findOldPayslips_, api_findOldPayslips, oldPayslipsJob, setSetting_, readRows_, upsert_, api_readSlipPdf, L };", ctx);
const G = ctx.__;

G.setup();
let d = G.api_getAll();
assert.strictEqual(d.students.length, 0); T("a fresh install starts empty: no one else's data");
assert.strictEqual(G.runCheck()[0].result, "Add the address your wages emails come from on the Profile page."); T("email checks wait until you set where wages emails come from");
demo.students.forEach(s => G.api_save("students", s.id, s));
demo.lessons.filter(l => l.source === "history").forEach(l => G.api_save("lessons", l.id, l));
G.setSetting_("senders", "admin@example.com"); G.setSetting_("calendarFrom", "2026-11-01");
const c7date = fmt(new Date(now - 48 * 36e5), "", "yyyy-MM-dd");
G.api_save("lessons", "old-ptm", { id: "old-ptm", date: c7date, time: "09:00", studentId: "tom", kind: "class", hours: 0.25, rate: 52.5, number: 11, eventId: "c7@" + c7date, source: "calendar", topic: "", notes: "" });
d = G.api_getAll();
const auto = d.lessons.find(l => l.source === "calendar" && l.kind === "class" && l.id !== "old-ptm");
assert(auto && auto.studentId === "sadhbh" && auto.hours === 1.5); T("calendar: a class that has ended is logged automatically (matched by course code)");
assert(d.calendar.planned.some(p => p.studentId === "tom")); T("calendar: upcoming class matched by name");
assert(d.calendar.unmatched.includes("Lunch")); T("calendar: everyday events are left alone");
{
  const trial = d.calendar.planned.find(p => p.title === "Applied Math Trial Class");
  assert(trial && trial.kind === "demo" && trial.studentId === "" && trial.hours === 0.5); T("calendar: a trial coming up is planned as Demo / trial, even with no student yet");
  assert(!d.calendar.unmatched.includes("Applied Math Trial Class"));
  const mtg = d.lessons.find(l => l.label === "Parent meeting - Leah");
  assert(mtg && mtg.kind === "meeting" && mtg.studentId === "leah" && mtg.hours === 0.25 && !mtg.number); T("calendar: a parent meeting that has ended is logged as a meeting, linked to the student but not a package class");
  const demoL = d.lessons.find(l => l.label === "Applied Math / Math Demo");
  assert(demoL && demoL.kind === "demo" && demoL.hours === 0.5 && demoL.rate === 35); T("calendar: an ended demo is logged with the trial rate (30 min at €35/h)");
  const fixed = d.lessons.find(l => l.id === "old-ptm");
  assert(fixed.kind === "meeting" && !fixed.number && fixed.label === "PTM Tom"); T("calendar: a meeting logged as a class before is turned into a meeting");
}

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
const bg = G.api_findOldPayslips();
assert(bg.result && bg.result.found >= 1 && /^done/.test(bg.data.status.oldSearch)); T("the button searches straight away and keeps the result on the Payslips page");
assert.strictEqual(JSON.stringify(G.L.parsePeriod("The payslip covers 5 weeks from 25 May to 28 June, you did 2 weeks", 2026)), JSON.stringify({ start: "2026-05-25", end: "2026-06-28" })); T("payslip email dates without a year (\"from 25 May to 28 June\") are understood");
// Older payslip emails that were already processed once still get their PDF linked; a contract PDF is ignored
messages.push(msg("m20", "Salary of August 2026", "Please find the payslip attached.", [pdf("Payslip 12 (31-08-2026).pdf")], "2026-09-08T10:00:00Z"));
messages.push(msg("m21", "Contract", "Your payslip will come monthly. Contract attached.", [pdf("Signed - Employment Contract.pdf")], "2026-06-16T10:00:00Z"));
G.upsert_("Payslips", { id: "slip-aug", periodStart: "2026-07-27", periodEnd: "2026-08-30", payDate: "2026-08-31", gross: 581.25, receivedDate: "2026-09-07", source: "history" });
G.upsert_("Processed", { messageId: "m20", type: "payslip", result: "seen before" });
const fo2 = G.api_findOldPayslips().result;
const aug = G.readRows_("Payslips").find(p => p.id === "slip-aug");
assert(aug.pdfUrl, "August got its PDF"); assert(fo2.months.includes("August payslip")); assert(!G.readRows_("Payslips").some(p => /Contract/.test(p.id))); assert(!fo2.months.some(x => /Contract/.test(x)));
T("an older payslip email seen before still gets its PDF linked to the right month; contracts are ignored");
// The number on the payslip is the employee number: a new month's payslip must not overwrite another month
messages.push(msg("m22", "Salary of October 2026", "Please find the payslip attached.", [pdf("Payslip 12 (31-10-2026).pdf")], "2026-11-12T10:00:00Z"));
G.runCheck();
const oct = G.readRows_("Payslips").find(p => p.payDate === "2026-10-31");
assert(oct && oct.id !== "slip-aug" && oct.periodEnd === "2026-10-25"); assert.strictEqual(G.readRows_("Payslips").find(p => p.periodEnd === "2026-09-27").payDate, "2026-09-30");
T("a new month's payslip gets its own entry (October period) instead of overwriting another month");
for (let i = 0; i < 300; i++) G.upsert_("Todos", { id: "dup" + i, text: "Write Leah's student report", done: false, createdAt: "2026-11-0" + (1 + i % 5), key: "report-leah-x" });
const t0 = Date.now(); const tds = G.api_getAll().todos.filter(x => x.key === "report-leah-x");
assert.strictEqual(tds.length, 1); T(`300 copies of a repeated to-do are cleaned up in one step (${Date.now() - t0} ms), one is kept`);
{ // A Sheet made before the "doneAt" column existed: ticking a to-do adds the column instead of losing the date
  const old = makeSheet(); old.appendRow(["id", "text", "done", "createdAt", "key"]); old.appendRow(["o1", "Old task", "FALSE", "2026-10-01", ""]); sheets.Todos = old;
  G.upsert_("Todos", { id: "o1", text: "Old task", done: true, createdAt: "2026-10-01", key: "", doneAt: "2026-11-08T12:00:00Z" });
  const r = G.readRows_("Todos").find(x => x.id === "o1"); assert.strictEqual(r.doneAt, "2026-11-08T12:00:00Z"); assert.strictEqual(r.text, "Old task");
  T("ticking a to-do in an older Sheet adds the new 'done on' column and keeps the date");
}
{ // Uploading a payslip PDF by hand (e.g. one that came by WhatsApp)
  const b64 = Buffer.from("%PDF fake").toString("base64");
  const nov = G.api_readSlipPdf("Payslip 12 (30-11-2026).pdf", b64);
  assert.strictEqual(nov.payDate, "2026-11-30"); assert.strictEqual(nov.paye, -12.4); assert.strictEqual(nov.usc, -6.1); assert.ok(nov.read && nov.gross > 0, "amounts read"); assert.strictEqual(nov.existingId, "", "no November payslip yet");
  assert.strictEqual(nov.periodEnd, "2026-11-29", "November period: ends on its last Sunday"); assert.ok(nov.pdfUrl, "Drive link filled in");
  assert.ok(!G.readRows_("Payslips").some(x => x.payDate === "2026-11-30"), "nothing saved until you press Save");
  const sep = G.readRows_("Payslips").find(x => x.payDate === "2026-09-30");
  assert.ok(sep); assert.strictEqual(G.api_readSlipPdf("Payslip 12 (30-09-2026).pdf", b64).existingId, sep.id, "same month updates the existing payslip");
  T("uploading a payslip PDF reads it and fills in the form, without adding a second payslip for the same month");
}
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
  const dbl = [{ id: "d1", studentId: "ella-a", date: "2026-11-01", hours: 2, rate: 35, kind: "class" }];
  assert.strictEqual(G.L.moneyIssues({ week: { start: "2026-10-26", end: "2026-11-01" }, lines: [ln(1), ln(2)] }, st2, dbl).length, 0);
  T("a double lesson logged as one 2-hour class matches admin's two 1-hour lines");
  const dbl2 = [{ id: "d1", studentId: "ella-a", date: "2026-11-01", hours: 2, rate: 35, kind: "class" }];
  assert.strictEqual(G.L.moneyIssues({ week: { start: "2026-10-26", end: "2026-11-01" }, lines: [ln(1)] }, st2, dbl2).length, 1);
  T("…but if admin only paid one of the two hours, that's still flagged");
}
console.log("\nall server checks pass");
