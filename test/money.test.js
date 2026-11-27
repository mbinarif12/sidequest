// Money scenarios: admin's weekly email lines against your log, for the situations that actually happen.
// Invented students only. Run: node test/money.test.js
const fs = require("fs"), vm = require("vm"), assert = require("assert"), path = require("path");
const T = s => console.log("✓ " + s);
const ctx = {}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "src", "shared", "logic.js"), "utf8") + "\nthis.L = L;", ctx);
const L = ctx.L;
const week = { start: "2026-11-02", end: "2026-11-08" };
const stu = (id, name, code, subject = "G12 Maths") => ({ id, name, code, subject, active: true });
const les = (id, studentId, date, time, hours, extra = {}) => ({ id, studentId, date, time, hours, rate: 35, kind: "class", ...extra });
const line = (n, label, code, date, time, hours, rate = 35) => ({ row: n, number: n, label, course: `${code} x`, code, date, time, hours, rate, subtotal: L.round2(hours * rate) });
const issues = (lines, students, lessons) => L.moneyIssues({ week, lines, totalHours: lines.reduce((a, l) => a + l.hours, 0), totalAmount: lines.reduce((a, l) => a + l.subtotal, 0) }, students, lessons);

{ // Class and a parent meeting with the same student on the same day
  const S = [stu("fionn", "Fionn", "IE7702")];
  const Ls = [les("m", "fionn", "2026-11-07", "13:00", 0.25, { kind: "meeting", rate: 20 }), les("c", "fionn", "2026-11-07", "12:00", 1)];
  const lines = [line(1, "Lesson(20)-9", "IE7702", "2026-11-07", "12:00", 1), line(2, "Parent teacher meeting", "IE7702", "2026-11-07", "13:00", 0.25, 20)];
  const out = issues(lines, S, Ls);
  assert.strictEqual(out.length, 0, JSON.stringify(out));
  T("a class and a parent meeting with the same student on the same day each match their own line (no false hours problem)");
}
{ // Rescheduled: admin lists the cancelled original (paid) and the make-up
  const S = [stu("tom", "Tom", "IE880001", "G12 Applied Maths")];
  const Ls = [les("mu", "tom", "2026-11-08", "11:00", 1.5)];
  const lines = [line(1, "Lesson(14)-9 make up", "IE880001", "2026-11-08", "11:00", 1.5), line(3, "Lesson(14)-9 sc>4 cancelled", "IE880001", "2026-11-07", "13:30", 1.5)];
  const out = issues(lines, S, Ls);
  assert.strictEqual(out.length, 1); assert.strictEqual(out[0].sev, "warn"); assert.ok(out[0].key && /cancelled/.test(out[0].text));
  T("a rescheduled class: the make-up matches, the cancelled-but-paid line is one amber \"paid more\" item you can handle by hand");
}
{ // No-show paid at 0.25 h
  const S = [stu("rory", "Rory", "IE7701")];
  const Ls = [les("n", "rory", "2026-11-05", "18:00", 0.25, { kind: "noshow" })];
  assert.strictEqual(issues([line(1, "Lesson -3 no show", "IE7701", "2026-11-05", "18:00", 0.25)], S, Ls).length, 0);
  T("a no-show you logged at 0.25 h matches admin's 0.25 h line");
}
{ // A skipped (cancelled) class that admin rightly leaves out
  const S = [stu("niamh", "Niamh", "IE7703")];
  const Ls = [les("x", "niamh", "2026-11-06", "15:15", 1.5, { kind: "cancelled", notes: "Skipped: away" }), les("y", "niamh", "2026-11-03", "18:00", 1.5)];
  assert.strictEqual(issues([line(1, "Lesson(20)-11", "IE7703", "2026-11-03", "18:00", 1.5)], S, Ls).length, 0);
  T("a class you skipped isn't reported as missing from admin's email");
}
{ // A trial logged without a student, admin lists it under a new course code
  const S = [stu("rory", "Rory", "IE7701")];
  const Ls = [les("t", "", "2026-11-04", "17:00", 0.5, { kind: "demo", label: "Applied Maths Trial class" })];
  assert.strictEqual(issues([line(1, "Trial class", "IE0999", "2026-11-04", "17:00", 0.5)], S, Ls).length, 0);
  T("a trial logged with no student matches admin's line by date and length");
}
{ // Two classes with the same student on one day (e.g. 15:00 and 18:00), admin lists both
  const S = [stu("leah", "Leah", "IE0700")];
  const Ls = [les("a", "leah", "2026-11-04", "18:00", 1), les("b", "leah", "2026-11-04", "15:00", 1.5)];
  const lines = [line(1, "Lesson 3", "IE0700", "2026-11-04", "15:00", 1.5), line(2, "Lesson 4", "IE0700", "2026-11-04", "18:00", 1)];
  assert.strictEqual(issues(lines, S, Ls).length, 0);
  T("two classes with one student on the same day each match their own line (by time and length)");
}
{ // Admin forgot a class: that's the real problem
  const S = [stu("leah", "Leah", "IE0700")];
  const out = issues([], S, [les("a", "leah", "2026-11-04", "18:00", 1)]);
  assert.strictEqual(out.length, 1); assert.strictEqual(out[0].sev, "bad");
  T("a class admin left out is a red problem");
}
{ // Admin paid fewer hours than taught
  const S = [stu("leah", "Leah", "IE0700")];
  const out = issues([line(1, "Lesson 3", "IE0700", "2026-11-04", "18:00", 1)], S, [les("a", "leah", "2026-11-04", "18:00", 1.5)]);
  assert.strictEqual(out.length, 1); assert.strictEqual(out[0].sev, "bad"); assert.ok(/hours/.test(out[0].text));
  T("admin paying 1 h for a 1.5 h class is a red problem");
}
{ // Payslip reading for each real layout we've seen: refund month (net > gross)
  const p = L.parsePayslip("Gross Pay 747.50 TOTAL DEDS -188.48 NET PAY 935.98 PAYE PRSI USC -184.80 0.00 -3.68", null);
  assert.strictEqual(p.gross, 747.5); assert.strictEqual(p.net, 935.98); assert.strictEqual(p.paye, -184.8); assert.strictEqual(p.usc, -3.68);
  T("payslip with a tax refund: gross, net, PAYE and USC read correctly");
}
{ // Pay periods: classes after the period's last Sunday belong to the next payment
  assert.strictEqual(L.periodFor("2026-10-25").end, "2026-10-25"); assert.strictEqual(L.periodFor("2026-10-26").end, "2026-11-29");
  T("pay periods: Sun 25 Oct is October's last day, Mon 26 Oct starts November's period");
}
console.log("all money scenarios pass");
