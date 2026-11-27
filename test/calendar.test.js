// Calendar scenarios: what happens to your log when you add, move, rename or delete events, over time.
// A fake clock and a fake Google Calendar you can edit between syncs, like you would in real life.
// Invented students only. Run: node test/calendar.test.js
const fs = require("fs"), vm = require("vm"), assert = require("assert"), path = require("path");
const T = s => console.log("✓ " + s);
// Values from inside the sandbox come from another JS realm, so compare them as JSON
const eqJ = (a, b, m) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), m);
const files = process.env.SQ_RELEASE ? [path.join(__dirname, "..", "release", "Code.gs")]
  : ["Logic.js", "Code.js"].map(f => path.join(__dirname, "..", "dist", f));
const CODE = files.map(f => fs.readFileSync(f, "utf8")).join("\n");

function makeSheet() {
  const data = [];
  return {
    getLastRow: () => data.length, getLastColumn: () => Math.max(0, ...data.map(r => r.length)), getMaxRows: () => 1000,
    getRange: (r, c, nr = 1, nc = 1) => ({
      getValues: () => [...Array(nr)].map((_, i) => [...Array(nc)].map((_, j) => (data[r - 1 + i] || [])[c - 1 + j] ?? "")),
      setValues(v) { v.forEach((row, i) => { data[r - 1 + i] = data[r - 1 + i] || []; row.forEach((x, j) => data[r - 1 + i][c - 1 + j] = x); }); return this; },
      setNumberFormat() { return this; }, setFontWeight() { return this; },
      clearContent() { for (let i = 0; i < nr; i++) if (data[r - 1 + i]) for (let j = 0; j < nc; j++) data[r - 1 + i][c - 1 + j] = ""; return this; },
    }),
    setFrozenRows() {}, appendRow: row => data.push(row), deleteRow: i => data.splice(i - 1, 1),
  };
}
const fmt = (d, tz, f) => { const z = n => String(n).padStart(2, "0"); const Y = d.getUTCFullYear(), M = z(d.getUTCMonth() + 1), D = z(d.getUTCDate()), h = z(d.getUTCHours()), m = z(d.getUTCMinutes());
  return f === "HH:mm" ? `${h}:${m}` : f === "yyyy-MM-dd" ? `${Y}-${M}-${D}` : `${Y}-${M}-${D} ${h}:${m}`; };

// A fresh SideQuest with its own clock and calendar. Times are written as "2026-11-24 18:00" (the fake runs in UTC).
function env(startAt) {
  const clock = { now: Date.parse(startAt.replace(" ", "T") + ":00Z") };
  class FakeDate extends Date {
    constructor(...a) { if (a.length === 0) super(clock.now); else if (a.length >= 3) super(Date.UTC(...a)); else super(...a); }
    static now() { return clock.now; }
  }
  const sheets = {}, cal = [];
  let nextId = 1;
  const wrap = e => ({ getId: () => e.id, getTitle: () => e.title, getStartTime: () => new Date(e.s), getEndTime: () => new Date(e.e), isAllDayEvent: () => !!e.allDay, getMyStatus: () => e.status || "OWNER" });
  const ctx = {
    console, Date: FakeDate,
    SpreadsheetApp: { getActive: () => ({ getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = makeSheet()), getSheets: () => Object.values(sheets), deleteSheet() {} }), getUi: () => ({}) },
    GmailApp: { search: () => [] },
    CalendarApp: {
      getDefaultCalendar: () => ({
        getEvents: (a, b) => cal.filter(e => !e.deleted && new Date(e.s) < b && new Date(e.e) > a).map(wrap),
        createEvent: (title, s, e) => { const ev = { id: "new" + nextId++, title, s: s.toISOString(), e: e.toISOString() }; cal.push(ev); return wrap(ev); },
      }),
      getCalendarById: () => null, GuestStatus: { NO: "NO", YES: "YES", OWNER: "OWNER", INVITED: "INVITED" },
    },
    MailApp: { sendEmail() {} }, Session: { getEffectiveUser: () => ({ getEmail: () => "alex@example.com" }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, tryLock: () => true, releaseLock() {} }) },
    Utilities: { formatDate: fmt, getUuid: () => Math.random().toString(16).slice(2) },
    ScriptApp: { getProjectTriggers: () => [], deleteTrigger() {}, WeekDay: { MONDAY: 1, TUESDAY: 2 }, newTrigger: () => { const t = { timeBased: () => t, onWeekDay: () => t, atHour: () => t, inTimezone: () => t, after: () => t, create() {} }; return t; } },
    DriveApp: {}, Drive: {}, DocumentApp: {}, MimeType: {},
  };
  vm.createContext(ctx);
  vm.runInContext(CODE + "\nthis.__ = { setup, api_getAll, api_save, api_remove, api_week, api_tagEvent, api_addEvent, api_deleteLesson, setSetting_, readRows_ };", ctx);
  const G = ctx.__;
  G.setup();
  G.setSetting_("calendarFrom", startAt.slice(0, 10));
  const at = t => Date.parse(t.replace(" ", "T") + ":00Z");
  const api = {
    G, cal, clock,
    to(t) { clock.now = at(t); return api; },
    event(id, title, s, mins) { const e = { id, title, s: new Date(at(s)).toISOString(), e: new Date(at(s) + mins * 6e4).toISOString() }; cal.push(e); return e; },
    move(e, s, mins) { e.s = new Date(at(s)).toISOString(); e.e = new Date(at(s) + (mins || (Date.parse(e.e) - Date.parse(e.s)) / 6e4) * 6e4).toISOString(); },
    del(e) { e.deleted = true; },
    student(id, name, more) { G.api_save("students", id, { id, name, subject: "G12 Maths", calKeyword: name, code: "", hours: 1, pkgSize: 20, active: true, ...more }); },
    sync() { return G.api_getAll(); },
    lessons(sid) { return G.readRows_("Lessons").filter(l => !sid || l.studentId === sid).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)); },
  };
  return api;
}

// ---------------------------------------------------------------------------------------------------------
{ const t = env("2026-11-23 09:00"); t.student("rory", "Rory");
  t.event("g1", "Rory - G12 Maths", "2026-11-24 18:00", 60);
  let d = t.to("2026-11-24 12:00").sync();
  assert.strictEqual(t.lessons().length, 0); assert.strictEqual(d.calendar.planned.length, 1);
  t.to("2026-11-24 19:05").sync();
  const ls = t.lessons("rory"); assert.strictEqual(ls.length, 1); assert.strictEqual(ls[0].time, "18:00"); assert.strictEqual(+ls[0].number, 1);
  T("a class is planned before it happens and logged once it's over, as lesson 1");
  t.to("2026-11-24 19:10").sync(); t.to("2026-11-24 19:20").sync();
  assert.strictEqual(t.lessons().length, 1); T("syncing again and again never duplicates a class");
}
{ const t = env("2026-11-23 09:00"); t.student("rory", "Rory");
  const e = t.event("g1", "Rory - G12 Maths", "2026-11-24 18:00", 60);
  t.to("2026-11-24 12:00").sync(); t.move(e, "2026-11-24 19:00");
  const d = t.to("2026-11-24 13:00").sync();
  assert.strictEqual(d.calendar.planned[0].time, "19:00");
  t.to("2026-11-24 20:05").sync();
  const ls = t.lessons(); assert.strictEqual(ls.length, 1); assert.strictEqual(ls[0].time, "19:00");
  T("moving a class to a later time before it happens: logged once, at the new time");
}
{ const t = env("2026-11-23 09:00"); t.student("rory", "Rory");
  const e = t.event("g1", "Rory - G12 Maths", "2026-11-24 18:00", 60);
  t.to("2026-11-24 19:05").sync(); t.move(e, "2026-11-24 19:00");
  t.to("2026-11-24 20:10").sync();
  const ls = t.lessons(); assert.strictEqual(ls.length, 1); assert.strictEqual(ls[0].time, "19:00");
  T("moving a class after it was logged (same event): the same lesson moves, no ghost left behind");
}
{ // Your Tuesday: the 18:00 class was logged, then you deleted it and made a new 19:00 event
  const t = env("2026-11-16 09:00"); t.student("rory", "Rory");
  t.event("p1", "Rory - G12 Maths", "2026-11-17 18:00", 60); t.to("2026-11-17 19:05").sync(); // last week's class: lesson 1
  const e = t.event("g1", "Rory - G12 Maths", "2026-11-24 18:00", 60);
  t.to("2026-11-24 19:01").sync();
  assert.strictEqual(+t.lessons().find(l => l.time === "18:00" && l.date === "2026-11-24").number, 2);
  t.del(e); t.event("g2", "Rory - G12 Maths", "2026-11-24 19:00", 60);
  const d = t.to("2026-11-24 20:05").sync();
  const tue = t.lessons().filter(l => l.date === "2026-11-24");
  assert.strictEqual(tue.length, 1, "only the 19:00 class is left"); assert.strictEqual(tue[0].time, "19:00");
  assert.strictEqual(+tue[0].number, 2, "it takes lesson 2, not 3"); assert.strictEqual(d.calendar.orphans.length, 0);
  T("deleting a logged class and making a new event at another time: the old one disappears and the new one keeps its lesson number");
}
{ const t = env("2026-11-23 09:00"); t.student("rory", "Rory");
  const e = t.event("g1", "Rory - G12 Maths", "2026-11-24 18:00", 60);
  t.to("2026-11-24 19:05").sync();
  const l = t.lessons()[0]; t.G.api_save("lessons", l.id, { ...l, topic: "Integration", notes: "Good" });
  t.del(e); const d = t.to("2026-11-24 20:00").sync();
  assert.strictEqual(t.lessons().length, 1, "your notes are never deleted"); eqJ(d.calendar.orphans, [l.id]);
  T("deleting an event for a class you wrote notes for: the class stays and you're asked what happened");
  t.G.api_save("lessons", l.id, { ...t.lessons()[0], eventId: "kept" });
  assert.strictEqual(t.to("2026-11-24 20:10").sync().calendar.orphans.length, 0); T("…and once you choose Keep, it stops asking");
}
{ const t = env("2026-11-23 09:00"); t.student("rory", "Rory");
  const e = t.event("g1", "Rory - G12 Maths", "2026-11-24 18:00", 60);
  t.to("2026-11-24 19:05").sync(); t.move(e, "2026-11-26 18:00");
  t.to("2026-11-25 10:00").sync();
  assert.strictEqual(t.lessons().length, 0, "Tuesday's untouched class goes");
  t.to("2026-11-26 19:05").sync();
  const ls = t.lessons(); assert.strictEqual(ls.length, 1); assert.strictEqual(ls[0].date, "2026-11-26"); assert.strictEqual(+ls[0].number, 1);
  T("moving a class to another day: it's logged on the new day only, still lesson 1");
}
{ const t = env("2026-11-23 09:00"); t.student("rory", "Rory");
  const e = t.event("g1", "Rory - G12 Maths", "2026-11-24 18:00", 60);
  t.to("2026-11-24 12:00").sync(); t.del(e);
  const d = t.to("2026-11-24 20:00").sync();
  assert.strictEqual(t.lessons().length, 0); assert.strictEqual(d.calendar.planned.length, 0);
  T("deleting a class before it happens: nothing is logged or planned");
}
{ const t = env("2026-11-02 09:00"); t.student("rory", "Rory");
  ["2026-11-03", "2026-11-10", "2026-11-17"].forEach(day => t.event("series1", "Rory - G12 Maths", day + " 18:00", 60)); // a weekly repeat shares one id
  t.to("2026-11-17 19:05").sync();
  eqJ(t.lessons().map(l => +l.number), [1, 2, 3]);
  T("a weekly repeating event: each week is its own class, numbered 1, 2, 3");
}
{ const t = env("2026-11-23 09:00"); t.student("rory", "Rory"); t.student("niamh", "Niamh");
  const e = t.event("g1", "Rory - G12 Maths", "2026-11-24 18:00", 60);
  t.to("2026-11-24 19:05").sync(); e.title = "Niamh - G12 Maths";
  t.to("2026-11-24 19:30").sync();
  const ls = t.lessons(); assert.strictEqual(ls.length, 1); assert.strictEqual(ls[0].studentId, "niamh"); assert.strictEqual(+ls[0].number, 1);
  T("renaming a logged (untouched) class to another student: it becomes their class");
}
{ // A new student's first class: SideQuest doesn't know them yet
  const t = env("2026-11-23 09:00"); t.student("rory", "Rory");
  t.event("a1", "IE901 - Orla G11 - Maths", "2026-11-28 11:00", 90);
  t.event("x1", "Dentist", "2026-11-28 15:00", 30);
  let d = t.to("2026-11-24 10:00").sync();
  eqJ(d.calendar.unknown.map(u => u.title), ["IE901 - Orla G11 - Maths"], "only the class-looking one is flagged");
  const w = t.G.api_week("2026-11-23").events;
  assert.ok(w.find(x => x.title.startsWith("IE901")).looksLikeClass); assert.ok(!w.find(x => x.title === "Dentist").looksLikeClass);
  T("an event with a course code or grade but no known student is flagged as \"looks like a class\" (a dentist appointment isn't)");
  t.student("orla", "Orla", { code: "IE901", subject: "G11 Maths" });
  d = t.G.api_tagEvent({ series: "a1", title: "IE901 - Orla G11 - Maths", tag: "student", studentId: "orla" });
  assert.strictEqual(d.calendar.unknown.length, 0); assert.strictEqual(d.calendar.planned[0].studentId, "orla");
  t.to("2026-11-28 12:35").sync();
  assert.strictEqual(t.lessons("orla").length, 1); T("adding them as a new student from the event: it's planned, then logged as their class");
}
{ const t = env("2026-11-23 09:00");
  t.event("j1", "T9912 kai G12 maths", "2026-11-25 19:30", 60);
  t.event("j2", "T9912 kai G12 maths", "2026-12-02 19:30", 60); // not a repeat: a separate event with the same title
  t.G.api_tagEvent({ series: "j1", title: "T9912 kai G12 maths", tag: "ignore" });
  const d = t.to("2026-11-24 10:00").sync(), w = t.G.api_week("2026-11-30").events;
  assert.strictEqual(d.calendar.unknown.length, 0); assert.ok(w[0].ignored && !w[0].looksLikeClass);
  T("\"Not teaching\" hides an event for good, including other events with exactly the same title");
}
{ const t = env("2026-11-23 09:00");
  t.event("t1", "Orla first session", "2026-11-28 11:00", 30);
  t.G.api_tagEvent({ series: "t1", title: "Orla first session", tag: "demo" });
  let d = t.to("2026-11-27 10:00").sync();
  assert.strictEqual(d.calendar.planned[0].kind, "demo");
  t.to("2026-11-28 11:40").sync();
  const l = t.lessons()[0]; assert.strictEqual(l.kind, "demo"); assert.strictEqual(l.hours, 0.5); assert.strictEqual(+l.rate, 35);
  T("an event marked as a trial (title doesn't say so): planned as a trial, logged as 30 min at the trial rate");
  t.G.api_tagEvent({ series: "t1", title: "Orla first session", tag: "" });
  assert.strictEqual(t.G.readRows_("EventTags").length, 0); T("\"Forget what I said\" removes the tag");
}
{ // Adding from SideQuest puts it in Google Calendar
  const t = env("2026-11-23 09:00"); t.student("rory", "Rory", { code: "IE7701", subject: "G12 Applied Maths" });
  t.to("2026-11-24 10:00");
  let d = t.G.api_addEvent({ type: "class", studentId: "rory", date: "2026-11-26", time: "18:00", minutes: 60 });
  assert.strictEqual(t.cal.length, 1); assert.strictEqual(t.cal[0].title, "IE7701 - Rory - G12 Applied Maths");
  assert.ok(d.calendar.planned.some(p => p.studentId === "rory" && p.date === "2026-11-26" && p.time === "18:00"));
  T("+ Add to calendar → class: a real Google Calendar event, shown as coming up for that student");
  d = t.G.api_addEvent({ type: "demo", name: "Orla", subject: "Applied Maths", date: "2026-11-28", time: "11:00", minutes: 30 });
  assert.strictEqual(t.cal[1].title, "Applied Maths – Trial class – Orla");
  assert.ok(d.calendar.planned.some(p => p.kind === "demo" && p.hours === 0.5));
  T("+ Add to calendar → trial in the future, no student yet: planned as a 30-minute trial");
  assert.throws(() => t.G.api_addEvent({ type: "class", date: "2026-11-26", time: "18:00" }), /student/);
  assert.throws(() => t.G.api_addEvent({ type: "class", studentId: "rory", date: "", time: "18:00" }), /date/);
  T("adding a class without a student or a date is refused with a clear message");
}
{ // Switching to another calendar must not wipe your log
  const t = env("2026-11-02 09:00"); t.student("rory", "Rory");
  const evs = ["2026-11-03", "2026-11-05", "2026-11-10", "2026-11-12", "2026-11-17", "2026-11-19", "2026-11-24"].map((day, i) => t.event("s" + i, "Rory - G12 Maths", day + " 18:00", 60));
  t.to("2026-11-24 19:05").sync(); assert.strictEqual(t.lessons().length, 7);
  evs.forEach(e => t.del(e));
  const d = t.to("2026-11-24 20:00").sync();
  assert.strictEqual(t.lessons().length, 7, "nothing deleted"); assert.strictEqual(d.calendar.orphans.length, 7, "you're asked instead");
  T("if many classes vanish at once (e.g. you switched calendars), nothing is deleted: you're asked instead");
}
{ const t = env("2026-11-23 09:00"); t.student("niamh", "Niamh");
  const e = t.event("j1", "Niamh - G12 Maths", "2026-11-27 15:15", 90);
  let d = t.to("2026-11-25 10:00").sync();
  const p = d.calendar.planned[0];
  t.G.api_save("lessons", "skip-1", { id: "skip-1", date: p.date, time: p.time, studentId: "niamh", kind: "cancelled", hours: 1.5, rate: 35, number: null, notes: "Skipped: away", eventId: p.eventId, source: "calendar" });
  d = t.to("2026-11-27 17:00").sync();
  const ls = t.lessons("niamh"); assert.strictEqual(ls.length, 1); assert.strictEqual(ls[0].kind, "cancelled");
  assert.ok(!d.calendar.planned.some(x => x.studentId === "niamh" && !x.lessonId));
  t.event("j2", "Niamh - G12 Maths", "2026-12-01 15:15", 90); t.to("2026-12-01 17:00").sync();
  assert.strictEqual(+t.lessons("niamh").find(l => l.kind === "class").number, 1);
  T("skipping a future class: never logged as taught, and the next class is still lesson 1");
}
{ const t = env("2026-11-23 09:00"); t.student("rory", "Rory");
  t.event("g1", "Rory - G12 Maths", "2026-11-19 18:00", 60); t.event("g2", "Rory - G12 Maths", "2026-11-26 18:00", 60);
  t.G.setSetting_("calendarFrom", "2026-11-01");
  t.to("2026-11-19 18:20").sync();
  const l = t.lessons()[0]; assert.ok(!l); // in progress: nothing logged yet
  t.to("2026-11-19 19:05").sync();
  const l1 = t.lessons()[0]; t.G.api_save("lessons", l1.id, { ...l1, kind: "noshow", hours: 0.25, number: null, notes: "Didn't show" });
  t.to("2026-11-26 19:05").sync();
  const next = t.lessons().find(x => x.date === "2026-11-26"); assert.strictEqual(+next.number, 1);
  T("a class in progress isn't logged yet; a no-show doesn't use up a lesson, so the next class is still lesson 1");
}
{ const t = env("2026-11-23 09:00"); t.student("leah", "Leah");
  const m = t.event("m1", "Parent meeting - Leah", "2026-11-24 17:00", 15);
  t.to("2026-11-24 17:20").sync(); t.move(m, "2026-11-24 17:30", 15);
  t.to("2026-11-24 18:00").sync();
  const l = t.lessons()[0]; assert.strictEqual(l.kind, "meeting"); assert.strictEqual(l.time, "17:30"); assert.ok(!l.number);
  t.event("c1", "Leah - G12 Maths", "2026-11-25 17:00", 60); t.to("2026-11-25 18:05").sync();
  assert.strictEqual(+t.lessons().find(x => x.kind === "class").number, 1);
  T("a parent meeting follows a time change, and never counts as one of the student's package lessons");
}
{ const t = env("2026-11-23 09:00"); t.student("rory", "Rory", { calKeyword: "Rory Maths" }); t.student("roryA", "Rory", { calKeyword: "Rory Applied", subject: "G12 Applied Maths", code: "IE7701" });
  t.event("a", "Rory G12 Applied Maths", "2026-11-24 18:00", 60); t.event("b", "Rory - G12 Maths", "2026-11-25 18:00", 60); t.event("c", "IE7701 Rory lesson", "2026-11-26 18:00", 60);
  t.to("2026-11-26 19:05").sync();
  const by = Object.fromEntries(t.lessons().map(l => [l.date, l.studentId]));
  eqJ(by, { "2026-11-24": "roryA", "2026-11-25": "rory", "2026-11-26": "roryA" });
  T("one student, two subjects: the event goes to the right one (course code first, then the most matching words)");
}
{ const t = env("2026-11-23 09:00"); t.student("rory", "Rory");
  t.cal.push({ id: "ad", title: "Rory's birthday", s: "2026-11-24T00:00:00Z", e: "2026-11-25T00:00:00Z", allDay: true });
  t.to("2026-11-25 10:00").sync(); assert.strictEqual(t.lessons().length, 0);
  T("all-day events are never classes");
}
{ // An event logged before the student existed is picked up once they're added
  const t = env("2026-11-23 09:00");
  t.event("n1", "Noah - G11 Maths", "2026-11-24 18:00", 60);
  t.to("2026-11-24 19:05").sync(); assert.strictEqual(t.lessons().length, 0);
  t.student("noah", "Noah"); t.to("2026-11-24 19:10").sync();
  assert.strictEqual(t.lessons("noah").length, 1);
  T("a class that happened before you added the student is logged as soon as you add them");
}
{ // A lesson linked in an older format (just the event id, no date) is still recognised: no duplicate, no deletion
  const t = env("2026-11-23 09:00"); t.student("rory", "Rory");
  t.event("old1", "Rory - G12 Maths", "2026-11-24 18:00", 60);
  t.G.api_save("lessons", "legacy", { id: "legacy", date: "2026-11-24", time: "18:00", studentId: "rory", kind: "class", hours: 1, rate: 35, number: 4, eventId: "old1", source: "calendar" });
  const d = t.to("2026-11-24 19:30").sync();
  assert.strictEqual(t.lessons().length, 1); assert.strictEqual(t.lessons()[0].id, "legacy"); assert.strictEqual(d.calendar.orphans.length, 0);
  T("a lesson saved by an older version (link without a date) is matched, not duplicated or deleted");
}
{ // Classes sent as invitations: deleting one in Google Calendar only marks it "declined"
  const t = env("2026-11-23 09:00"); t.student("rory", "Rory");
  const inv = t.event("inv18", "Rory - G12 Maths", "2026-11-24 18:00", 60); inv.status = "YES";
  t.to("2026-11-24 19:05").sync(); assert.strictEqual(t.lessons().length, 1);
  inv.status = "NO"; t.event("inv19", "Rory - G12 Maths", "2026-11-24 19:00", 60);
  t.to("2026-11-24 20:05").sync();
  const ls = t.lessons(); assert.strictEqual(ls.length, 1); assert.strictEqual(ls[0].time, "19:00");
  assert.ok(!t.G.api_week("2026-11-23").events.some(e => e.start === "18:00"));
  T("an invitation you deleted (declined) in Google Calendar counts as gone: only the 19:00 class is logged or shown");
}
{ // Deleting a class in SideQuest while its event still exists in the calendar
  const t = env("2026-11-23 09:00"); t.student("rory", "Rory");
  t.event("rep", "Rory - G12 Maths", "2026-11-24 18:00", 60); t.event("rep", "Rory - G12 Maths", "2026-12-01 18:00", 60);
  t.to("2026-11-24 19:05").sync();
  t.G.api_deleteLesson(t.lessons()[0].id);
  t.to("2026-11-24 19:30").sync(); t.to("2026-11-25 10:00").sync();
  assert.strictEqual(t.lessons().length, 0, "it doesn't come back");
  t.to("2026-12-01 19:05").sync();
  assert.strictEqual(t.lessons().length, 1, "next week's class in the same series is still logged");
  T("deleting a calendar class in SideQuest: it doesn't come back on the next sync, and the rest of the series still works");
}
{ // Your Wednesday: "this and following events" on a repeating event gives Google a new event id
  const t = env("2026-11-23 09:00"); t.student("rory", "Rory");
  const a = t.event("seriesA", "IE7701 - Rory - G12 Maths", "2026-11-25 19:00", 60);
  t.to("2026-11-25 20:05").sync();
  const l = t.lessons()[0]; t.G.api_save("lessons", l.id, { ...l, topic: "Lines", notes: "Good class" });
  t.del(a); t.event("seriesA_R20261124T180000", "IE7701 - Rory - G12 Maths", "2026-11-25 18:00", 60); // the split series (Google reports the old 6 PM)
  const d = t.to("2026-11-27 20:10").sync();
  const wed = t.lessons().filter(x => x.date === "2026-11-25");
  assert.strictEqual(wed.length, 1, "no second class"); assert.strictEqual(wed[0].time, "19:00", "your written-up 7 PM class stays as it is");
  assert.strictEqual(wed[0].eventId, "seriesA_R20261124T180000@2026-11-25"); assert.strictEqual(d.calendar.orphans.length, 0);
  T("Google changes an event's id (repeating event split): your written-up class is re-attached, nothing logged twice, nothing to ask");
}
{ // The state your Sheet is in now: a kept 7 PM class and an untouched 6 PM duplicate for the same day
  const t = env("2026-11-23 09:00"); t.student("rory", "Rory");
  t.event("split", "IE7701 - Rory - G12 Maths", "2026-11-25 18:00", 60);
  t.G.api_save("lessons", "kept7", { id: "kept7", date: "2026-11-25", time: "19:00", studentId: "rory", kind: "class", hours: 1, rate: 35, number: 7, topic: "Lines", eventId: "kept", source: "calendar" });
  t.G.api_save("lessons", "dup6", { id: "dup6", date: "2026-11-25", time: "18:00", studentId: "rory", kind: "class", hours: 1, rate: 35, number: 10, eventId: "split@2026-11-25", source: "calendar" });
  t.event("fri", "IE7701 - Rory - G12 Maths", "2026-11-27 18:00", 60);
  t.G.api_save("lessons", "fri9", { id: "fri9", date: "2026-11-27", time: "18:00", studentId: "rory", kind: "class", hours: 1, rate: 35, number: 9, eventId: "fri@2026-11-27", source: "calendar" });
  t.to("2026-11-27 20:30").sync();
  const wed = t.lessons().filter(x => x.date === "2026-11-25");
  assert.strictEqual(wed.length, 1); assert.strictEqual(wed[0].id, "kept7"); assert.strictEqual(wed[0].eventId, "split@2026-11-25");
  assert.strictEqual(+t.lessons().find(x => x.id === "fri9").number, 8, "Friday closes the gap: 9 → 8");
  T("your current Wednesday is repaired on the next sync: the 6 PM duplicate goes, the 7 PM class stays and is re-linked, and Friday becomes lesson 8 again");
}
{ // Two separate classes with one student on one day are never merged
  const t = env("2026-11-23 09:00"); t.student("rory", "Rory");
  t.G.api_save("lessons", "am", { id: "am", date: "2026-11-25", time: "10:00", studentId: "rory", kind: "class", hours: 1, rate: 35, number: 1, topic: "x", eventId: "kept", source: "calendar" });
  t.event("pm", "Rory - G12 Maths", "2026-11-25 18:00", 60);
  t.to("2026-11-25 19:05").sync();
  assert.strictEqual(t.lessons().length, 2); T("a morning and an evening class with the same student stay two separate classes");
}
console.log("all calendar scenarios pass");
