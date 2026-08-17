// Tests for static/add/index.html (the browser-based capture form).
// Run with: node tests/add.test.js   (or `npm test` to run everything)

const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = path.join(__dirname, "..");
const HTML = fs.readFileSync(path.join(ROOT, "static/add/index.html"), "utf8");

async function run(mockFetch, presetCfg, url) {
  let capturedRequest = null;
  const requests = [];
  const dom = new JSDOM(HTML, {
    url: url || "https://jaschro.github.io/glob/add/",
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
    beforeParse(window) {
      if (presetCfg) window.localStorage.setItem("glob-cfg", JSON.stringify(presetCfg));
      window.confirm = function () { return true; };
      window.fetch = async (url, opts) => {
        if (String(url).includes("index.json")) {
          return { ok: true, json: async () => [
            { title: "a", categories: ["Technology"], subcategory: "AI" },
            { title: "b", categories: ["Music"], subcategory: "Live Sets" }
          ]};
        }
        capturedRequest = { url, opts };
        requests.push({ url, opts });
        return mockFetch(url, opts);
      };
    }
  });
  await new Promise((r) => setTimeout(r, 30));
  return { window: dom.window, getRequest: () => capturedRequest, getRequests: () => requests };
}

function setFiles(doc, id, files) {
  Object.defineProperty(doc.getElementById(id), "files", { value: files, configurable: true });
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

  await check("type toggle shows email fields, hides URL and note fields", async () => {
    const { window } = await run(async () => ({ ok: true, json: async () => ({}) }), { user: "jaschro", repo: "glob", token: "tkn" });
    const doc = window.document;
    doc.querySelector('[data-type="email"]').dispatchEvent(new window.Event("click", { bubbles: true }));
    assert.strictEqual(doc.getElementById("email-fields").classList.contains("hidden"), false);
    assert.strictEqual(doc.getElementById("url-field").classList.contains("hidden"), true);
    assert.strictEqual(doc.getElementById("note-field").classList.contains("hidden"), true);
    assert.strictEqual(doc.getElementById("post-body-field").classList.contains("hidden"), true);
  });

  await check("tweet type (default) shows URL and note fields, hides body field", async () => {
    const { window } = await run(async () => ({ ok: true, json: async () => ({}) }), { user: "jaschro", repo: "glob", token: "tkn" });
    const doc = window.document;
    assert.strictEqual(doc.getElementById("url-field").classList.contains("hidden"), false);
    assert.strictEqual(doc.getElementById("note-field").classList.contains("hidden"), false);
    assert.strictEqual(doc.getElementById("post-body-field").classList.contains("hidden"), true);
  });

  await check("post type shows only the body field, hides URL/note/email", async () => {
    const { window } = await run(async () => ({ ok: true, json: async () => ({}) }), { user: "jaschro", repo: "glob", token: "tkn" });
    const doc = window.document;
    doc.querySelector('[data-type="post"]').dispatchEvent(new window.Event("click", { bubbles: true }));
    assert.strictEqual(doc.getElementById("post-body-field").classList.contains("hidden"), false);
    assert.strictEqual(doc.getElementById("url-field").classList.contains("hidden"), true);
    assert.strictEqual(doc.getElementById("note-field").classList.contains("hidden"), true);
    assert.strictEqual(doc.getElementById("email-fields").classList.contains("hidden"), true);
  });

  await check("settings screen has a Save button that persists and returns to the main screen", async () => {
    const { window } = await run(async () => ({ ok: true, json: async () => ({}) }));
    const doc = window.document;
    setVal(doc, "cfg-user", "jaschro");
    setVal(doc, "cfg-repo", "glob");
    setVal(doc, "cfg-token", "tkn999");
    doc.getElementById("settings-save").dispatchEvent(new window.Event("click", { bubbles: true }));
    assert.strictEqual(doc.getElementById("screen-main").classList.contains("on"), true);
    assert.strictEqual(JSON.parse(window.localStorage.getItem("glob-cfg")).token, "tkn999");
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

  await check("leading text (note) is placed in the body ahead of the embed", async () => {
    const { window, getRequest } = await run(async () => ({ ok: true, json: async () => ({}) }), { user: "jaschro", repo: "glob", token: "tkn123" });
    const doc = window.document;
    setVal(doc, "f-title", "Cool thread");
    setVal(doc, "f-category", "Technology");
    setVal(doc, "f-url", "https://twitter.com/x/status/456");
    setVal(doc, "f-note", "Worth reading for the third reply.");
    submit(doc);
    await new Promise((r) => setTimeout(r, 30));
    const body = JSON.parse(getRequest().opts.body);
    const decoded = Buffer.from(body.content, "base64").toString("utf8");
    assert.ok(decoded.includes("Worth reading for the third reply."));
    assert.ok(decoded.includes('source_url: "https://twitter.com/x/status/456"'));
  });

  await check("Post type submits a long-form body with no source_url", async () => {
    const { window, getRequest } = await run(async () => ({ ok: true, json: async () => ({}) }), { user: "jaschro", repo: "glob", token: "tkn123" });
    const doc = window.document;
    doc.querySelector('[data-type="post"]').dispatchEvent(new window.Event("click", { bubbles: true }));
    setVal(doc, "f-title", "A written post");
    setVal(doc, "f-category", "Journal");
    setVal(doc, "f-post-body", "This is the full text of a normal blog post.");
    submit(doc);
    await new Promise((r) => setTimeout(r, 30));
    const body = JSON.parse(getRequest().opts.body);
    const decoded = Buffer.from(body.content, "base64").toString("utf8");
    assert.ok(decoded.includes("type: post"));
    assert.ok(decoded.includes("This is the full text of a normal blog post."));
    assert.ok(!decoded.includes("source_url:"));
  });

  await check("Post type blocks submit when the body is empty", async () => {
    const { window, getRequest } = await run(async () => { throw new Error("must not be called"); }, { user: "jaschro", repo: "glob", token: "tkn" });
    const doc = window.document;
    doc.querySelector('[data-type="post"]').dispatchEvent(new window.Event("click", { bubbles: true }));
    setVal(doc, "f-title", "Empty post");
    setVal(doc, "f-category", "Journal");
    submit(doc);
    await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(getRequest(), null);
  });

  await check("images upload before the post, then appear as markdown in the body", async () => {
    const { window, getRequests } = await run(async () => ({ ok: true, json: async () => ({}) }), { user: "jaschro", repo: "glob", token: "tkn123" });
    const doc = window.document;
    setVal(doc, "f-title", "Photo post");
    setVal(doc, "f-category", "Personal");
    const file = new window.File(["fake-image-bytes"], "cat.png", { type: "image/png" });
    setFiles(doc, "f-images", [file]);
    submit(doc);
    await new Promise((r) => setTimeout(r, 60));
    const reqs = getRequests();
    assert.strictEqual(reqs.length, 2, "expected one image PUT then one post PUT");
    assert.ok(String(reqs[0].url).includes("static/images/"));
    assert.ok(String(reqs[0].url).endsWith(".png"));
    const postBody = JSON.parse(reqs[1].opts.body);
    const decoded = Buffer.from(postBody.content, "base64").toString("utf8");
    assert.ok(decoded.includes("![](/glob/images/"));
  });

  const EDIT_URL = "https://jaschro.github.io/glob/add/?edit=2026-08-15-utility-bill-note.md";
  const EXISTING_RAW = [
    "---",
    'title: "Utility note"',
    "date: 2026-08-15",
    "type: email",
    'categories: ["Personal"]',
    'subcategory: "Admin"',
    'email_from: "billing@utilityco.example"',
    'email_subject: "Re: Account correction confirmed"',
    "---",
    "",
    "Thanks for confirming -- the duplicate charge has been reversed.",
    ""
  ].join("\n");
  const EXISTING_SHA = "sha-abc123";

  function mockGetExisting(url, opts) {
    if (!opts || !opts.method) {
      return { ok: true, json: async () => ({ content: Buffer.from(EXISTING_RAW, "utf8").toString("base64"), sha: EXISTING_SHA }) };
    }
    return { ok: true, json: async () => ({ content: { sha: "sha-new" } }) };
  }

  await check("an ?edit= link loads the existing post into the form", async () => {
    const { window } = await run(mockGetExisting, { user: "jaschro", repo: "glob", token: "tkn" }, EDIT_URL);
    const doc = window.document;
    assert.strictEqual(doc.getElementById("form-heading").textContent, "Edit post");
    assert.strictEqual(doc.getElementById("f-title").value, "Utility note");
    assert.strictEqual(doc.getElementById("f-category").value, "Personal");
    assert.strictEqual(doc.getElementById("f-subcategory").value, "Admin");
    assert.strictEqual(doc.getElementById("f-email-from").value, "billing@utilityco.example");
    assert.ok(doc.getElementById("f-email-body").value.includes("duplicate charge has been reversed"));
    assert.strictEqual(doc.getElementById("email-fields").classList.contains("hidden"), false);
    assert.strictEqual(doc.getElementById("submit-btn").textContent, "Save changes");
    assert.strictEqual(doc.getElementById("delete-btn").classList.contains("hidden"), false);
  });

  await check("saving an edited post PUTs to the original path with the original sha", async () => {
    const { window, getRequests } = await run(mockGetExisting, { user: "jaschro", repo: "glob", token: "tkn" }, EDIT_URL);
    const doc = window.document;
    setVal(doc, "f-email-body", "Thanks for confirming -- updated text.");
    submit(doc);
    await new Promise((r) => setTimeout(r, 30));
    const reqs = getRequests();
    const putReq = reqs.find((r) => r.opts && r.opts.method === "PUT");
    assert.ok(putReq, "expected a PUT request");
    assert.ok(String(putReq.url).endsWith("content/posts/2026-08-15-utility-bill-note.md"));
    const body = JSON.parse(putReq.opts.body);
    assert.strictEqual(body.sha, EXISTING_SHA);
    assert.ok(body.message.startsWith("Update post:"));
    const decoded = Buffer.from(body.content, "base64").toString("utf8");
    assert.ok(decoded.includes("updated text"));
    assert.ok(decoded.includes("date: 2026-08-15"), "should keep the original date, not today's");
  });

  await check("deleting an edited post sends a DELETE with the sha", async () => {
    const { window, getRequests } = await run(mockGetExisting, { user: "jaschro", repo: "glob", token: "tkn" }, EDIT_URL);
    const doc = window.document;
    doc.getElementById("delete-btn").dispatchEvent(new window.Event("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    const reqs = getRequests();
    const delReq = reqs.find((r) => r.opts && r.opts.method === "DELETE");
    assert.ok(delReq, "expected a DELETE request");
    const body = JSON.parse(delReq.opts.body);
    assert.strictEqual(body.sha, EXISTING_SHA);
    assert.ok(String(delReq.url).endsWith("content/posts/2026-08-15-utility-bill-note.md"));
    assert.strictEqual(doc.getElementById("delete-btn").classList.contains("hidden"), true);
    assert.ok(doc.getElementById("status").textContent.includes("Deleted"));
  });

  await check("opening an edit link with no saved credentials shows Settings first, then resumes the edit on Save", async () => {
    const { window } = await run(mockGetExisting, null, EDIT_URL);
    const doc = window.document;
    assert.strictEqual(doc.getElementById("screen-settings").classList.contains("on"), true);
    setVal(doc, "cfg-user", "jaschro");
    setVal(doc, "cfg-repo", "glob");
    setVal(doc, "cfg-token", "tkn");
    doc.getElementById("settings-save").dispatchEvent(new window.Event("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    assert.strictEqual(doc.getElementById("screen-main").classList.contains("on"), true);
    assert.strictEqual(doc.getElementById("f-title").value, "Utility note");
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
