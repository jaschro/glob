// Tests for static/add/index.html (the browser-based capture form).
// Run with: node tests/add.test.js   (or `npm test` to run everything)

const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = path.join(__dirname, "..");
const HTML = fs.readFileSync(path.join(ROOT, "static/add/index.html"), "utf8");

async function run(mockFetch, presetCfg) {
  let capturedRequest = null;
  const dom = new JSDOM(HTML, {
    url: "https://jaschro.github.io/glob/add/",
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
    beforeParse(window) {
      if (presetCfg) window.localStorage.setItem("glob-cfg", JSON.stringify(presetCfg));
      window.fetch = async (url, opts) => {
        if (String(url).includes("index.json")) {
          return { ok: true, json: async () => [
            { title: "a", categories: ["Technology"], subcategory: "AI" },
            { title: "b", categories: ["Music"], subcategory: "Live Sets" }
          ]};
        }
        capturedRequest = { url, opts };
        return mockFetch(url, opts);
      };
    }
  });
  await new Promise((r) => setTimeout(r, 30));
  return { window: dom.window, getRequest: () => capturedRequest };
}

function setVal(doc, id, val) {
  const el = doc.getElementById(id);
  el.value = val;
  el.dispatchEvent(new doc.defaultView.Event("input", { bubbles: true }));
}

function submit(doc) {
  doc.getElementById("add-form").dispatchEvent(new doc.defaultView.Event("submit", { bubbles: true, cancelable: true }));
}

let passed = 0;
function check(name, fn) {
  return fn().then(() => {
    passed++;
    console.log("  ok - " + name);
  });
}

async function main() {
  await check("settings screen shown first when no credentials saved", async () => {
    const { window } = await run(async () => ({ ok: true, json: async () => ({}) }));
    assert.strictEqual(window.document.getElementById("screen-settings").classList.contains("on"), true);
    assert.strictEqual(window.document.getElementById("screen-main").classList.contains("on"), false);
  });

  await check("main screen shown when credentials already saved", async () => {
    const { window } = await run(async () => ({ ok: true, json: async () => ({}) }), { user: "jaschro", repo: "glob", token: "tkn" });
    assert.strictEqual(window.document.getElementById("screen-main").classList.contains("on"), true);
  });

  await check("category/subcategory datalists populate from the live post index", async () => {
    const { window } = await run(async () => ({ ok: true, json: async () => ({}) }), { user: "jaschro", repo: "glob", token: "tkn" });
    const cats = Array.from(window.document.getElementById("category-list").options).map((o) => o.value);
    assert.deepStrictEqual(cats.sort(), ["Music", "Technology"]);
  });

  await check("type toggle shows email fields, hides URL field", async () => {
    const { window } = await run(async () => ({ ok: true, json: async () => ({}) }), { user: "jaschro", repo: "glob", token: "tkn" });
    const doc = window.document;
    doc.querySelector('[data-type="email"]').dispatchEvent(new window.Event("click", { bubbles: true }));
    assert.strictEqual(doc.getElementById("email-fields").classList.contains("hidden"), false);
    assert.strictEqual(doc.getElementById("url-field").classList.contains("hidden"), true);
  });

  await check("submit blocked when title/category missing -- no request sent", async () => {
    const { window, getRequest } = await run(async () => { throw new Error("must not be called"); }, { user: "jaschro", repo: "glob", token: "tkn" });
    submit(window.document);
    await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(getRequest(), null);
  });

  await check("successful tweet submission builds correct frontmatter and request", async () => {
    const { window, getRequest } = await run(async () => ({ ok: true, json: async () => ({}) }), { user: "jaschro", repo: "glob", token: "tkn123" });
    const doc = window.document;
    setVal(doc, "f-title", "A Cool Test Post!");
    setVal(doc, "f-category", "Technology");
    setVal(doc, "f-subcategory", "AI");
    setVal(doc, "f-url", "https://twitter.com/x/status/123");
    submit(doc);
    await new Promise((r) => setTimeout(r, 30));
    const req = getRequest();
    assert.ok(req, "expected a request to be made");
    assert.strictEqual(req.opts.method, "PUT");
    assert.strictEqual(req.opts.headers.Authorization, "Bearer tkn123");
    const body = JSON.parse(req.opts.body);
    assert.strictEqual(body.branch, "main");
    const decoded = Buffer.from(body.content, "base64").toString("utf8");
    assert.ok(decoded.includes('type: tweet'));
    assert.ok(decoded.includes('categories: ["Technology"]'));
    assert.ok(decoded.includes('subcategory: "AI"'));
    assert.ok(decoded.includes('source_url: "https://twitter.com/x/status/123"'));
    assert.strictEqual(doc.getElementById("f-title").value, "", "form should reset after success");
  });

  await check("email submission puts the body after frontmatter, not in it", async () => {
    const { window, getRequest } = await run(async () => ({ ok: true, json: async () => ({}) }), { user: "jaschro", repo: "glob", token: "tkn123" });
    const doc = window.document;
    doc.querySelector('[data-type="email"]').dispatchEvent(new window.Event("click", { bubbles: true }));
    setVal(doc, "f-title", "Utility note");
    setVal(doc, "f-category", "Personal");
    setVal(doc, "f-email-from", "billing@utilityco.example");
    setVal(doc, "f-email-body", "The charge was reversed.");
    submit(doc);
    await new Promise((r) => setTimeout(r, 30));
    const body = JSON.parse(getRequest().opts.body);
    const decoded = Buffer.from(body.content, "base64").toString("utf8");
    assert.ok(decoded.endsWith("The charge was reversed.\n"));
    assert.ok(decoded.includes('email_from: "billing@utilityco.example"'));
  });

  await check("UTF-8 titles (emoji/accents) survive the base64 round trip", async () => {
    const { window, getRequest } = await run(async () => ({ ok: true, json: async () => ({}) }), { user: "jaschro", repo: "glob", token: "tkn123" });
    const doc = window.document;
    setVal(doc, "f-title", "Café ☕ post");
    setVal(doc, "f-category", "Personal");
    submit(doc);
    await new Promise((r) => setTimeout(r, 30));
    const body = JSON.parse(getRequest().opts.body);
    const decoded = Buffer.from(body.content, "base64").toString("utf8");
    assert.ok(decoded.includes("Café ☕ post"));
  });

  await check("GitHub error message is surfaced, not swallowed", async () => {
    const { window } = await run(async () => ({ ok: false, status: 401, json: async () => ({ message: "Bad credentials" }) }), { user: "jaschro", repo: "glob", token: "bad" });
    const doc = window.document;
    setVal(doc, "f-title", "Will fail");
    setVal(doc, "f-category", "Test");
    submit(doc);
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(doc.getElementById("status").textContent.includes("Bad credentials"));
    assert.strictEqual(doc.getElementById("submit-btn").disabled, false);
  });

  await check("unparseable error body still shows a sane fallback message", async () => {
    const { window } = await run(async () => ({ ok: false, status: 500, json: async () => { throw new Error("not json"); } }), { user: "jaschro", repo: "glob", token: "tkn" });
    const doc = window.document;
    setVal(doc, "f-title", "Will fail 2");
    setVal(doc, "f-category", "Test");
    submit(doc);
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(doc.getElementById("status").textContent.includes("500"));
  });

  console.log(passed + " passed");
}

main().catch((err) => {
  console.error("FAIL:", err.message);
  process.exit(1);
});
