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
writeFileSync(join(out, "Index.html"), src("web/shell.html").replace("/*LOGIC*/", () => logic).replace("/*APP*/", () => src("web/app.js")));
copyFileSync(join(root, "src", "appsscript.json"), join(out, "appsscript.json"));
// Your own history file stays on your computer (private/ is git-ignored)
if (existsSync(join(root, "private", "History.js"))) copyFileSync(join(root, "private", "History.js"), join(out, "History.js"));
console.log("Built dist/: Code.js, Logic.js, Index.html, appsscript.json");
