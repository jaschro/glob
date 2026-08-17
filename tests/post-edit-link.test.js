// Tests for the "Edit this post" PAT-gating script embedded in
// layouts/_default/single.html. The script is extracted from the real
// template file and run standalone (the surrounding page is a Hugo
// template, not static HTML, so it can't be loaded as a full document).
// Run with: node tests/post-edit-link.test.js   (or `npm test` for everything)

const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = path.join(__dirname, "..");
const TEMPLATE = fs.readFileSync(path.join(ROOT, "layouts/_default/single.html"), "utf8");

const scriptMatch = TEMPLATE.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) {
  throw new Error("Couldn't find the edit-link <script> block in layouts/_default/single.html");
}
const SCRIPT = scriptMatch[1];

function run(presetCfg) {
  const dom = new JSDOM(
    '<p class="edit-link"><a href="/glob/add/?edit=x.md" id="edit-post-link">Edit this post</a></p>',
    { url: "https://jaschro.github.io/glob/posts/x/", runScripts: "dangerously" }
  );
  if (presetCfg) dom.window.localStorage.setItem("glob-cfg", JSON.stringify(presetCfg));
  const scriptEl = dom.window.document.createElement("script");
  scriptEl.textContent = SCRIPT;
  dom.window.document.body.appendChild(scriptEl);
  return dom.window;
}

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log("  ok - " + name);
}

check("edit link is greyed out when no PAT is saved", () => {
  const window = run(null);
  const link = window.document.getElementById("edit-post-link");
  assert.strictEqual(link.classList.contains("disabled"), true);
  assert.ok(link.title && link.title.length > 0, "expected an explanatory title/tooltip");
});

check("edit link is greyed out when the saved config is incomplete", () => {
  const window = run({ user: "jaschro", repo: "", token: "" });
  const link = window.document.getElementById("edit-post-link");
  assert.strictEqual(link.classList.contains("disabled"), true);
});

check("edit link is active (not greyed out) once a full PAT is saved", () => {
  const window = run({ user: "jaschro", repo: "glob", token: "tkn123" });
  const link = window.document.getElementById("edit-post-link");
  assert.strictEqual(link.classList.contains("disabled"), false);
});

check("clicking a greyed-out link is a no-op, not a navigation to the Add page", () => {
  const window = run(null);
  const link = window.document.getElementById("edit-post-link");
  const evt = new window.MouseEvent("click", { bubbles: true, cancelable: true });
  link.dispatchEvent(evt);
  assert.strictEqual(evt.defaultPrevented, true);
});

console.log(passed + " passed");
