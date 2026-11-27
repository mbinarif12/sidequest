// Clicks every button on every page (and every button in each dialog that opens), at laptop and phone size,
// in light and dark mode, and fails on any script error or broken text ("undefined", "NaN", "[object Object]").
// Uses invented demo data and a pretend server in the page. Run: node test/ui-crawl.js   (needs Playwright)
const { chromium } = require("playwright");
const { page0 } = require("./ui-fixture.js");
const VIEWS = process.env.VIEWS ? process.env.VIEWS.split(",") : ["home", "lessons", "students", "payslips", "claim", "profile"];
const BAD_TEXT = /\bundefined\b|\bNaN\b|\[object Object\]|Invalid Date/;

(async () => {
  const b = await chromium.launch(), problems = []; let clicks = 0;
  // Laptop/light: every button and every dialog button. Dark mode and phone: every page and every first-level button.
  for (const vp of [{ name: "laptop", width: 1280, height: 900, deep: true }, { name: "phone", width: 390, height: 844 }, { name: "laptop", width: 1280, height: 900, dark: true }]) {
    for (const scheme of [vp.dark ? "dark" : "light"]) {
      const ctx = await b.newContext({ viewport: { width: vp.width, height: vp.height }, colorScheme: scheme });
      const fresh = async () => {
        const pg = await ctx.newPage(), errs = [];
        pg.on("pageerror", e => errs.push("script error: " + e.message));
        await pg.clock.setFixedTime(new Date("2026-11-06T15:00:00Z")); // the demo data's "now"
        pg.on("console", m => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errs.push("console error: " + m.text()); }); // fonts can't load offline
        await pg.goto("file://" + page0); await pg.waitForSelector("nav"); await pg.waitForTimeout(80);
        return { pg, errs };
      };
      const go = async (pg, v) => { if (v !== "home") { await pg.evaluate(v => { view = v; sel = null; render(); }, v); await pg.waitForTimeout(120); } };
      const check = async (pg, errs, where) => {
        const txt = await pg.evaluate(() => document.body.innerText);
        const m = txt.match(BAD_TEXT); if (m) errs.push(`broken text "${m[0]}" near: …${txt.slice(Math.max(0, m.index - 60), m.index + 40).replace(/\n/g, " ")}…`);
        const wide = await pg.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        if (wide > 2) errs.push(`page scrolls sideways by ${wide}px`);
        errs.forEach(e => problems.push(`[${vp.name}/${scheme}] ${where}: ${e}`)); errs.length = 0;
      };
      for (const v of VIEWS) {
        let { pg, errs } = await fresh(); await go(pg, v); await check(pg, errs, `${v} (opened)`);
        const n = await pg.locator("main [data-act]:visible, header [data-act]:visible").count(); await pg.close();
        console.log(`  ${vp.name}/${scheme} ${v}: ${n} buttons`);
        for (let i = 0; i < n; i++) {
          ({ pg, errs } = await fresh()); await go(pg, v);
          const el = pg.locator("main [data-act]:visible, header [data-act]:visible").nth(i);
          const label = `${v} › ${await el.getAttribute("data-act")} "${((await el.innerText().catch(() => "")) || "").trim().replace(/\s+/g, " ").slice(0, 30)}"`;
          if (/^(nophoto|reload)$/.test(await el.getAttribute("data-act"))) { await pg.close(); continue; }
          await el.click({ timeout: 2000 }).catch(e => errs.push("couldn't click: " + e.message.split("\n")[0])); clicks++;
          await pg.waitForTimeout(120); await check(pg, errs, label);
          // A dialog opened: click each of its buttons (each in a fresh copy of this state)
          const nd = vp.deep ? await pg.locator("dialog[open] [data-act]:visible").count() : 0; await pg.close();
          for (let j = 0; j < nd; j++) {
            ({ pg, errs } = await fresh()); await go(pg, v);
            await pg.locator("main [data-act]:visible, header [data-act]:visible").nth(i).click({ timeout: 2000 }).catch(() => {}); await pg.waitForTimeout(150);
            const d = pg.locator("dialog[open] [data-act]:visible").nth(j);
            const dl = `${label} › ${await d.getAttribute("data-act").catch(() => "?")} "${((await d.innerText().catch(() => "")) || "").trim().replace(/\s+/g, " ").slice(0, 25)}"`;
            await d.click({ timeout: 2000 }).catch(e => errs.push("couldn't click: " + e.message.split("\n")[0])); clicks++;
            await pg.waitForTimeout(120); await check(pg, errs, dl); await pg.close();
          }
        }
      }
      await ctx.close();
    }
  }
  await b.close();
  const uniq = [...new Set(problems)];
  console.log(`${clicks} clicks`);
  if (uniq.length) { console.log(uniq.join("\n")); process.exit(1); }
  console.log("✓ every button on every page, laptop + phone, light + dark: no errors, no broken text");
})();
