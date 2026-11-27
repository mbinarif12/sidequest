// Walks through real situations in the browser and checks what SideQuest shows and sends.
// Invented demo data, pretend server (see ui-fixture.js). Run: node test/ui-flows.js   (needs Playwright)
const { chromium } = require("playwright");
const assert = require("assert");
const { page0 } = require("./ui-fixture.js");
const T = s => console.log("✓ " + s);

(async () => {
  const b = await chromium.launch(), ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const open = async view => {
    const pg = await ctx.newPage(), errs = [];
    pg.on("pageerror", e => errs.push(e.message));
    await pg.clock.setFixedTime(new Date("2026-11-06T15:00:00Z")); // the demo data's "now"
    await pg.goto("file://" + page0); await pg.waitForSelector("nav"); await pg.waitForTimeout(100);
    if (view) { await pg.click(`nav >> text=${view}`); await pg.waitForTimeout(250); }
    pg.errs = errs; return pg;
  };
  const calls = (pg, name) => pg.evaluate(n => window.calls.filter(c => c[0] === n).map(c => c.slice(1)), name);
  const toastText = pg => pg.locator("#toast, .toast").last().innerText().catch(() => "");
  try {
    // 1) A new student's first class in the calendar (IE901 - Orla G11): shown as "looks like a class", fixable in two clicks
    let pg = await open("Calendar");
    const unk = pg.locator(".ev.unk", { hasText: "IE901" });
    assert.strictEqual(await unk.count(), 1, "the IE901 event is highlighted"); assert.match(await unk.innerText(), /Not linked/);
    await unk.click(); await pg.waitForSelector("dialog[open] .tagopts");
    await pg.click("dialog[open] [data-act=tagnew]"); await pg.waitForTimeout(150);
    assert.strictEqual(await pg.inputValue("#s_n"), "Orla"); assert.strictEqual(await pg.inputValue("#s_c"), "IE901"); assert.strictEqual(await pg.inputValue("#s_sub"), "G11 Maths");
    await pg.fill("#s_p", "10"); await pg.click("dialog[open] [data-act=savestu]"); await pg.waitForTimeout(300);
    const st = (await calls(pg, "api_save")).find(c => c[0] === "students"), tg = (await calls(pg, "api_tagEvent"))[0];
    assert.ok(st && tg, "student saved, then the event linked"); assert.strictEqual(tg[0].tag, "student"); assert.strictEqual(tg[0].studentId, st[1]); assert.strictEqual(tg[0].series, "unk1");
    T("unknown class (IE901 - Orla G11) → Add student, pre-filled from the title (Orla, IE901, G11 Maths) → the event is linked to her");
    await pg.close();

    pg = await open("Calendar");
    await pg.locator(".ev.unk").first().click(); await pg.waitForSelector("dialog[open] .tagopts");
    await pg.click("dialog[open] [data-act=tagset][data-tag=student]"); await pg.waitForTimeout(100);
    assert.match(await toastText(pg), /Choose the student/);
    await pg.selectOption("#tg_s", { index: 1 }); await pg.click("dialog[open] [data-act=tagset][data-tag=student]"); await pg.waitForTimeout(250);
    assert.ok((await calls(pg, "api_tagEvent"))[0][0].studentId); T("…or link it to a student you already have (asks you to pick one first)");
    await pg.close();

    for (const [tag, what] of [["demo", "a trial"], ["meeting", "a meeting"], ["ignore", "not teaching"]]) {
      pg = await open("Calendar"); await pg.locator(".ev.other", { hasText: "Lunch" }).first().click(); await pg.waitForSelector("dialog[open] .tagopts");
      await pg.click(`dialog[open] [data-act=tagset][data-tag=${tag}]`); await pg.waitForTimeout(250);
      assert.strictEqual((await calls(pg, "api_tagEvent"))[0][0].tag, tag); await pg.close();
    }
    T("any grey event can be marked as a trial, a meeting or not teaching");
    pg = await open("Calendar"); await pg.locator(".ev.other", { hasText: "Gym" }).first().click(); await pg.waitForSelector("dialog[open] .tagopts");
    await pg.click("dialog[open] [data-act=tagset][data-tag='']"); await pg.waitForTimeout(250);
    assert.strictEqual((await calls(pg, "api_tagEvent"))[0][0].tag, ""); T("an event you tagged before shows \"Forget what I said\"");
    await pg.close();

    pg = await open(); const todo = pg.locator("[data-act=todo][data-t=tagev]");
    assert.strictEqual(await todo.count(), 1); await todo.click(); await pg.waitForSelector("dialog[open] .tagopts");
    assert.match(await pg.locator("dialog[open] h2").innerText(), /IE901/); T("Home lists \"IE901 - Orla G11 isn't linked to a student\" as a to-do that opens the same choice");
    await pg.close();

    // 2) Adding something in the future from SideQuest
    pg = await open("Calendar");
    await pg.click("[data-act=addev]"); await pg.waitForSelector("dialog[open] #ae_d");
    await pg.click("dialog[open] [data-act=addevsave]"); await pg.waitForTimeout(100);
    assert.match(await toastText(pg), /Choose the student/); T("+ Add to calendar: a class needs a student");
    await pg.selectOption("#ae_s", { index: 1 }); await pg.fill("#ae_d", "2026-11-01"); await pg.click("dialog[open] [data-act=addevsave]"); await pg.waitForTimeout(100);
    assert.match(await toastText(pg), /passed/); T("…a date that has passed is refused, pointing to Log past work");
    await pg.fill("#ae_d", "2026-11-20"); await pg.fill("#ae_t", "17:00"); await pg.click("dialog[open] [data-act=addevsave]"); await pg.waitForTimeout(300);
    let add = (await calls(pg, "api_addEvent"))[0][0];
    assert.strictEqual(add.type, "class"); assert.ok(add.studentId); assert.strictEqual(add.date, "2026-11-20"); assert.strictEqual(add.time, "17:00");
    assert.ok(!(await pg.locator("dialog[open]").count()), "dialog closes"); T("…a future class goes to Google Calendar with the right student, date and time");
    await pg.click("[data-act=addev]"); await pg.waitForSelector("dialog[open]"); await pg.click("dialog[open] [data-act=addevtype][data-k=demo]"); await pg.waitForTimeout(100);
    assert.strictEqual(await pg.inputValue("#ae_m"), "30"); await pg.fill("#ae_name", "Orla"); await pg.fill("#ae_d", "2026-11-28"); await pg.fill("#ae_t", "11:00");
    await pg.click("dialog[open] [data-act=addevsave]"); await pg.waitForTimeout(300);
    add = (await calls(pg, "api_addEvent"))[1][0]; assert.strictEqual(add.type, "demo"); assert.strictEqual(add.name, "Orla"); assert.strictEqual(add.minutes, 30);
    T("…a trial for someone who isn't a student yet: 30 minutes by default, sent with their name");
    await pg.close();

    // 3) A class you wrote notes for whose event was deleted: clearly marked, not "needs notes"
    pg = await open("Calendar");
    const gone = pg.locator(".ev.gone"); assert.strictEqual(await gone.count(), 1); assert.match(await gone.innerText(), /Not in your calendar/);
    await gone.click(); await pg.waitForSelector("dialog[open]");
    assert.match(await pg.locator("dialog[open]").innerText(), /no longer in your calendar/); assert.ok(await pg.locator("dialog[open] [data-act=orphankeep]").count());
    T("a written-up class whose event you deleted shows as \"Not in your calendar now\" and asks Keep or Delete");
    await pg.close();

    // Deleting a class that came from the calendar: remembered, so it doesn't come back
    pg = await open("Calendar"); await pg.locator(".ev.cw", { hasText: "Paren" }).first().click(); await pg.waitForSelector("dialog[open]");
    await pg.click("dialog[open] [data-act=dellesson]"); await pg.waitForTimeout(80); await pg.click("dialog[open] [data-act=dellesson]"); await pg.waitForTimeout(300);
    const dl = await calls(pg, "api_deleteLesson"); assert.strictEqual(dl.length, 1); assert.match(await toastText(pg), /won't come back/);
    T("deleting a class that came from the calendar asks to confirm, then is remembered so the next sync doesn't bring it back");
    await pg.close();

    // Skipping a future class still works
    pg = await open("Calendar"); await pg.click("[data-act=wk][data-n='7']"); await pg.waitForTimeout(250);
    const fut = pg.locator(".ev.plan", { hasText: "Darragh" }); await fut.first().click(); await pg.waitForSelector("dialog[open]");
    await pg.click("dialog[open] [data-act=skipopen]"); await pg.fill("#p_skip", "Away"); await pg.click("dialog[open] [data-act=skipsave]"); await pg.waitForTimeout(250);
    const sk = (await calls(pg, "api_save")).find(c => c[0] === "lessons")[2];
    assert.strictEqual(sk.kind, "cancelled"); assert.strictEqual(sk.number, null); assert.match(sk.notes, /Away/);
    T("skipping a future class saves it as cancelled with your reason and no lesson number");
    await pg.close();

    // Pay check: the cancelled-but-paid line explains itself and can be handled with an amount
    pg = await open(); await pg.click("button[data-act=issues]"); await pg.waitForSelector("dialog[open]");
    const li = pg.locator("dialog[open] li", { hasText: "cancelled" });
    assert.match(await li.innerText(), /still paid it/); await li.locator("[data-act=ovr]").click(); await pg.waitForSelector("#o_why");
    await pg.click("dialog[open] [data-act=ovrsave]"); await pg.waitForTimeout(100); assert.match(await toastText(pg), /reason/);
    await pg.fill("#o_why", "Rescheduled"); await pg.fill("#o_amt", "0"); await pg.click("dialog[open] [data-act=ovrsave]"); await pg.waitForTimeout(250);
    const ov = (await calls(pg, "api_save")).find(c => c[0] === "overrides")[2]; assert.strictEqual(ov.amount, 0); assert.strictEqual(ov.reason, "Rescheduled");
    T("a paid-but-cancelled line says so, needs a reason to handle, and saves the amount you set");
    await pg.close();

    const errs = []; for (const p of ctx.pages()) errs.push(...p.errs);
    assert.strictEqual(errs.length, 0, errs.join("\n"));
    console.log("all browser flows pass");
  } catch (e) { console.error(e); process.exitCode = 1; }
  await b.close();
})();
