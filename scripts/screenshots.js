// Renders the web page with invented demo data and saves the README screenshots to docs/screenshots/.
// Run: node scripts/build.mjs && node scripts/screenshots.js   (needs Playwright)
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path");
const { state, weeks } = require("../test/demo.js");
(async () => {
  const out = path.join(__dirname, "..", "docs", "screenshots"); fs.mkdirSync(out, { recursive: true });
  const stub = `<script>window.google = { script: { get run() { let ok; const r = new Proxy({}, { get(_, k) {
      if (k === "withSuccessHandler") return f => (ok = f, r); if (k === "withFailureHandler") return () => r;
      return (...a) => setTimeout(() => ok(k === "api_week" ? (${JSON.stringify(weeks)})[a[0]] || { events: [] } : k === "api_getAll" || k === "api_sync" ? ${JSON.stringify(state)} : true), 30); } }); return r; } } };
      window.scrollTo = () => {};</script>`;
  const page = path.join(out, "_page.html");
  fs.writeFileSync(page, fs.readFileSync(path.join(__dirname, "..", "dist", "Index.html"), "utf8").replace("<head>", "<head>" + stub));
  const b = await chromium.launch(), errs = [];
  const pg = await b.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
  pg.on("pageerror", e => errs.push(e.message));
  await pg.goto("file://" + page); await pg.waitForTimeout(500);
  const shot = async (name, full = true) => { await pg.waitForTimeout(250); await pg.screenshot({ path: path.join(out, name + ".png"), fullPage: full }); };
  await shot("home");
  await pg.click("nav [data-v=lessons]"); await pg.waitForTimeout(300); await pg.setViewportSize({ width: 1280, height: 1180 }); await shot("lessons", false); await pg.setViewportSize({ width: 1280, height: 860 });
  await pg.click(".ev.need"); await shot("class-notes", false); await pg.click("dialog [data-act=close]");
  await pg.click("nav [data-v=payslips]"); await shot("payslips");
  await pg.click("nav [data-v=claim]"); await shot("payment-claim", false);
  await pg.click("nav [data-v=home]"); await pg.click("[data-act=issues]"); await shot("pay-problems", false); await pg.click("dialog [data-act=close]");
  await pg.click("nav [data-v=profile]"); await shot("profile");
  const ph = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await ph.goto("file://" + page); await ph.waitForTimeout(500); await ph.screenshot({ path: path.join(out, "phone-home.png") });
  await b.close(); fs.unlinkSync(page);
  console.log(errs.length ? errs.join("\n") : "screenshots saved to docs/screenshots/");
})();
