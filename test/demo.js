// Invented demo data (no real people) used by the tests and the README screenshots.
const L = require("../src/shared/logic.js");
const TODAY = "2026-11-06";
const students = [
  { id: "sadhbh", name: "Sadhbh", subject: "G12 Maths (H)", code: "IE1042", calKeyword: "Sadhbh", hours: 1.5, pkgSize: 20, active: true, notes: "Exam-focused; strong on algebra." },
  { id: "darragh", name: "Darragh", subject: "G12 Maths (H)", code: "IE4410", calKeyword: "Darragh", hours: 1, pkgSize: 20, active: true, notes: "Needs basics revised alongside new topics." },
  { id: "tom", name: "Tom", subject: "G12 Applied Maths (H)", code: "IE2051", calKeyword: "Tom", hours: 1.5, pkgSize: 14, active: true, notes: "Small group (Tom, sometimes Ellie)." },
  { id: "leah", name: "Leah", subject: "G11 Maths (H)", code: "IE3307", calKeyword: "Leah", hours: 1, pkgSize: 10, active: true, notes: "Building confidence with functions." },
];
const slot = { sadhbh: [2, "17:00"], darragh: [3, "18:00"], tom: [6, "12:30"], leah: [6, "14:15"] }; // weekday (0=Sun), time
const topics = {
  sadhbh: ["Functions: turning points", "Indices and logs", "Surds", "Coordinate geometry: the line", "Differentiation: first principles", "Chain rule", "Product and quotient rules", "Exam practice: Paper 1", "Integration intro"],
  darragh: ["Algebra refresher", "Solving equations", "Quadratics", "Trigonometry: SOHCAHTOA", "Sine and cosine rule", "Area of a triangle", "Exam practice"],
  tom: ["Uniform acceleration", "Projectiles", "Newton's laws", "Connected particles", "Collisions", "Circular motion", "Differential equations"],
  leah: ["Number systems", "Algebra: factorising", "Functions intro", "Graphs of functions", "Patterns and sequences", "Exam-style questions", "Revision", "Probability", "Statistics"],
};
const remarks = ["All good. Will move on next class.", "Slow class: spent time on homework questions. Make a recap sheet.", "Strong progress, ready for harder exam questions.", "Struggled with the homework; will revisit at the start of next class."];
const lessons = [], startDate = "2026-09-01";
const counters = { sadhbh: 0, darragh: 0, tom: 0, leah: 0 };
for (let d = startDate; d <= "2026-11-05"; d = L.addDays(d, 1)) {
  for (const s of students) {
    const [wd, time] = slot[s.id];
    if (L.weekday(d) !== wd) continue;
    const n = ++counters[s.id];
    lessons.push({ id: `h-${d}-${s.id}`, date: d, time, studentId: s.id, label: "", kind: "class", hours: s.hours, rate: 35, number: n,
      topic: topics[s.id][(n - 1) % topics[s.id].length], homework: `Ex ${n}.${(n % 4) + 1}`, notes: remarks[(n + s.name.length) % remarks.length],
      followups: "", followupsDone: false, source: "history" });
  }
}
const lastOf = id => lessons.filter(l => l.studentId === id).pop();
lastOf("tom").followups = "Send Tom the chapter recap";
Object.assign(lastOf("darragh"), { topic: "", homework: "", notes: "", source: "calendar", eventId: "d1" }); // logged from the calendar, waiting for notes
lessons.push({ id: "h-trial", date: "2026-10-17", time: "10:00", studentId: "", label: "G12 Maths trial – Niamh", kind: "demo", hours: 0.5, rate: 35, topic: "Trial class", notes: "Went well.", source: "history" });
lessons.push({ id: "h-meet", date: "2026-10-01", time: "", studentId: "", label: "Team meeting", kind: "meeting", hours: 1, rate: 20, notes: "Term planning", source: "history" });
const sum = (a, b) => a.filter(l => l.date >= b.start && l.date <= b.end).reduce((x, l) => x + L.amountOf(l), 0);
const sep = { start: "2026-08-31", end: "2026-09-27" };
const payslips = [{ id: "slip-sep", number: 12, payDate: "2026-09-30", periodStart: sep.start, periodEnd: sep.end, gross: L.round2(sum(lessons, sep)), net: L.round2(sum(lessons, sep) + 18.5), cumulativeGross: 3010.25, receivedDate: "2026-10-15", pdfUrl: "#", source: "email" }];
// Admin's weekly statements for October (one week has an underpaid line)
const statements = [];
for (let w = "2026-09-28"; w <= "2026-10-26"; w = L.addDays(w, 7)) {
  const we = L.addDays(w, 6);
  const lines = lessons.filter(l => l.date >= w && l.date <= we).map((l, i) => {
    const s = students.find(x => x.id === l.studentId);
    let hours = l.hours; if (w === "2026-10-12" && l.studentId === "darragh") hours = 0.5;
    return { row: i + 1, label: s ? `Lesson(${s.pkgSize})-${l.number} ${s.code} ${s.name}` : l.kind === "meeting" ? "M0001 Team meeting" : "T0901 Niamh Trial class", code: s ? s.code : l.kind === "meeting" ? "M0001" : "T0901", counter: l.number || null, pkgSize: s ? s.pkgSize : null, date: l.date, time: l.time, duration: l.hours, hours, rate: l.rate, subtotal: L.round2(hours * l.rate), teacher: "Alex", trial: !s };
  });
  if (lines.length) statements.push({ id: w, week: { start: w, end: we }, lines, totalHours: lines.reduce((a, l) => a + l.hours, 0), totalAmount: lines.reduce((a, l) => a + l.subtotal, 0), source: "email", resolved: false });
}
// Calendar: this week and next, with classes and everyday events
function weekEvents(mon) {
  const ev = [];
  const add = (date, title, start, end, studentId = "") => ev.push({ key: `${title}@${date}`, title, allDay: false, date, start, end, endDate: date, startIso: `${date}T${start}:00Z`, studentId });
  for (let i = 0; i < 7; i++) {
    const d = L.addDays(mon, i), wd = L.weekday(d);
    if (wd >= 1 && wd <= 5) add(d, "Lunch", "13:00", "14:00");
    if (wd === 1 || wd === 3) add(d, "Lecture: Statistics", "14:00", "15:00");
    if (wd === 4) add(d, "Gym", "07:30", "08:30");
    for (const s of students) { const [w, t] = slot[s.id]; if (w === wd) { const end = L.addDays(d, 0); const [h, m] = t.split(":").map(Number); const em = h * 60 + m + s.hours * 60; add(d, `${s.code} - ${s.subject.replace(" (H)", "")} - ${s.name}`, t, `${String(Math.floor(em / 60)).padStart(2, "0")}:${String(em % 60).padStart(2, "0")}`, s.id); } }
  }
  return { error: "", events: ev };
}
const weeks = { "2026-11-02": weekEvents("2026-11-02"), "2026-11-09": weekEvents("2026-11-09") };
const planned = [...weeks["2026-11-02"].events, ...weeks["2026-11-09"].events].filter(e => e.studentId && e.date > "2026-11-06" || (e.studentId && e.date === "2026-11-06"))
  .map(e => ({ eventId: e.key, studentId: e.studentId, date: e.date, time: e.start, hours: students.find(s => s.id === e.studentId).hours, start: `${e.date}T${e.start}:00Z`, title: e.title, lessonId: "" }));
const state = {
  students, lessons, statements, payslips, todos: [{ id: "t1", text: "Book exam paper printing", done: false, createdAt: "2026-11-05" }],
  lastRun: "2026-11-02T09:12:00Z", today: TODAY, now: `${TODAY}T15:00:00Z`,
  calendar: { created: 0, planned, unmatched: ["Lunch", "Gym", "Lecture: Statistics"], orphans: [], error: "" },
  profile: { teacherName: "Alex Teacher", adminName: "Sam", email: "alex.teacher@example.com", subjects: "Leaving Cert Maths (H), Applied Maths (H)", theme: "light", calendarId: "primary", autoLog: "yes", emailSummary: "yes", senders: "admin@example.com" },
  rates: [{ from: "2020-01-01", class: 35, trial: 35, other: 20 }],
};
module.exports = { state, weeks, students, lessons };
