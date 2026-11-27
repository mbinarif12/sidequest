// Shared by the browser tests: the demo data plus every situation the page has to draw, and a pretend server
// inside the page that keeps changes in memory and records every call in window.calls.
const fs = require("fs"), path = require("path"), os = require("os");
const { state, weeks } = require("./demo.js");
// Demo data plus every situation the page has to draw
const st = JSON.parse(JSON.stringify(state));
st.eventtags = [{ id: "tag-1", series: "ign1", title: "Gym", tag: "ignore", studentId: "", at: "2026-11-01T10:00:00Z" }];
st.overrides = [];
const sd = st.students[0].id;
st.lessons.push({ id: "orph1", date: "2026-11-04", time: "18:00", studentId: sd, kind: "class", hours: 1, rate: 35, number: 3, topic: "Algebra", notes: "ok", eventId: "gone@2026-11-04", source: "calendar" });
st.lessons.push({ id: "meet1", date: "2026-11-05", time: "13:00", studentId: sd, kind: "meeting", label: "Parent meeting", hours: 0.25, rate: 20, number: "", eventId: "pm1@2026-11-05", source: "calendar" });
st.lessons.push({ id: "skip1", date: "2026-11-10", time: "17:00", studentId: "sadhbh", kind: "cancelled", hours: 1.5, rate: 35, number: null, notes: "Skipped: away", eventId: "sk1@2026-11-10", source: "calendar" });
st.calendar.orphans = ["orph1"];
st.calendar.unknown = [{ series: "unk1", title: "IE901 - Orla G11 - Maths", date: "2026-11-07", time: "11:00" }];
st.calendar.planned.push({ eventId: "tr1@2026-11-08", studentId: "", kind: "demo", label: "Applied Maths – Trial class", date: "2026-11-08", time: "10:00", hours: 0.5, start: "2026-11-08T10:00:00Z", title: "Applied Maths – Trial class", lessonId: "" });
const w1 = weeks["2026-11-02"];
w1.events.push(
  { key: "unk1@2026-11-07", title: "IE901 - Orla G11 - Maths", allDay: false, date: "2026-11-07", start: "11:00", end: "12:30", endDate: "2026-11-07", startIso: "2026-11-07T11:00:00Z", studentId: "", kind: "", series: "unk1", looksLikeClass: true },
  { key: "ign1@2026-11-05", title: "Gym", allDay: false, date: "2026-11-05", start: "07:00", end: "08:00", endDate: "2026-11-05", startIso: "2026-11-05T07:00:00Z", studentId: "", kind: "", series: "ign1", ignored: true, tagged: true },
  { key: "pm1@2026-11-05", title: "Parent meeting", allDay: false, date: "2026-11-05", start: "13:00", end: "13:15", endDate: "2026-11-05", startIso: "2026-11-05T13:00:00Z", studentId: sd, kind: "meeting", series: "pm1" },
  { key: "tr1@2026-11-08", title: "Applied Maths – Trial class", allDay: false, date: "2026-11-08", start: "10:00", end: "10:30", endDate: "2026-11-08", startIso: "2026-11-08T10:00:00Z", studentId: "", kind: "demo", series: "tr1" },
);
const wk1 = st.statements[st.statements.length - 1];
wk1.lines.push({ row: 99, number: 99, label: "Lesson(14)-9 sc>4 cancelled", course: "IE260999 x", code: "IE260999", date: wk1.week.start, time: "13:30", hours: 1.5, rate: 35, subtotal: 52.5 });

const pretendServer = `<script>(function () {
  window.calls = [];
  const STATE = ${JSON.stringify(st)}, WEEKS = ${JSON.stringify(weeks)};
  const all = () => JSON.parse(JSON.stringify(STATE));
  const api = {
    api_getAll: all, api_sync: all, api_week: ws => WEEKS[ws] || { events: [], error: "" },
    api_save: (col, id, data) => { const a = STATE[col] = STATE[col] || []; const i = a.findIndex(x => x.id === id); i >= 0 ? a.splice(i, 1, { ...data, id }) : a.push({ ...data, id }); return true; },
    api_remove: (col, id) => { STATE[col] = (STATE[col] || []).filter(x => x.id !== id); return true; },
    api_tagEvent: t => { STATE.eventtags = STATE.eventtags.filter(x => x.series !== t.series); if (t.tag) STATE.eventtags.push({ id: "tag-" + Math.random(), ...t }); return all(); },
    api_deleteLesson: id => { STATE.lessons = STATE.lessons.filter(x => x.id !== id); return all(); },
    api_addEvent: x => { if (x.type === "class" && !x.studentId) throw new Error("Pick the student for this class."); return all(); },
    api_runNow: () => ({ results: [{ subject: "Weekly wages", result: "Checked" }], data: all() }),
    api_readSlipPdf: () => ({ read: true, payDate: "2026-11-30", periodStart: "2026-10-26", periodEnd: "2026-11-29", gross: 500, net: 490, paye: 0, usc: 10, pdfUrl: "https://drive.google.com/x", pdfText: "x" }),
    api_findOldPayslips: () => ({ result: { found: 0, months: [], already: [], emails: 3, problems: [], missing: [] }, data: all() }),
  };
  window.google = { script: { get run() { let ok = () => {}, bad = () => {}; const r = new Proxy({}, { get(_, k) {
    if (k === "withSuccessHandler") return f => (ok = f, r); if (k === "withFailureHandler") return f => (bad = f, r);
    return (...a) => { window.calls.push([k, ...a]); setTimeout(() => { try { ok(api[k] ? api[k](...a) : all()); } catch (e) { bad(e); } }, 15); }; } }); return r; } } };
})();</script>`;

const page0 = path.join(os.tmpdir(), "sq-crawl.html");
fs.writeFileSync(page0, fs.readFileSync(path.join(__dirname, "..", "dist", "Index.html"), "utf8").replace("<head>", "<head>" + pretendServer));
module.exports = { page0 };
