// Builds the Apps Script project into dist/: Code.js, Logic.js, Index.html, appsscript.json.
// The same logic.js runs on the server (Logic.js) and inside the web page (Index.html).
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = p => readFileSync(join(root, "src", p), "utf8");
const out = join(root, "dist");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const logic = src("shared/logic.js").replace(/if \(typeof module !== "undefined"\) module\.exports = L;\n?/, "");
writeFileSync(join(out, "Logic.js"), "// Shared checking logic (the same code runs in the web page).\n" + logic);
writeFileSync(join(out, "Code.js"), src("server/Code.js"));
// The page's code goes in as base64 (in 76-character lines) so Google's HtmlService can't change it in transit
const code = Buffer.from(logic + "\n" + src("web/app.js"), "utf8").toString("base64").replace(/.{76}/g, "$&\n");
writeFileSync(join(out, "Index.html"), src("web/shell.html").replace("/*CODE*/", () => "\n" + code + "\n"));
copyFileSync(join(root, "src", "appsscript.json"), join(out, "appsscript.json"));
// Your own history file stays on your computer (private/ is git-ignored)
if (existsSync(join(root, "private", "History.js"))) copyFileSync(join(root, "private", "History.js"), join(out, "History.js"));
// Ready-to-paste files for people installing by hand (attached to each GitHub Release): Code.gs holds everything server-side
const rel = join(root, "release");
rmSync(rel, { recursive: true, force: true }); mkdirSync(rel, { recursive: true });
writeFileSync(join(rel, "Code.gs"), src("server/Code.js") + "\n\n// ---- Shared checking logic ----\n" + logic);
copyFileSync(join(out, "Index.html"), join(rel, "Index.html"));
copyFileSync(join(out, "appsscript.json"), join(rel, "appsscript.json"));
console.log("Built dist/ (Code.js, Logic.js, Index.html, appsscript.json) and release/ (Code.gs, Index.html, appsscript.json)");
