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

  await check("pasting a YouTube URL while Tweet is selected auto-switches the type (prevents the broken-embed bug)", async () => {
    const { window } = await run(async () => ({ ok: true, json: async () => ({}) }), { user: "jaschro", repo: "glob", token: "tkn" });
    const doc = window.document;
    assert.strictEqual(doc.querySelector('[data-type="tweet"]').classList.contains("active"), true, "sanity: starts on Tweet");
    setVal(doc, "f-url", "https://www.youtube.com/watch?v=ncYOVGrbHwo");
    assert.strictEqual(doc.querySelector('[data-type="youtube"]').classList.contains("active"), true);
    assert.strictEqual(doc.querySelector('[data-type="tweet"]').classList.contains("active"), false);
  });

  await check("pasting a Spotify/SoundCloud URL auto-switches to Music", async () => {
    const { window } = await run(async () => ({ ok: true, json: async () => ({}) }), { user: "jaschro", repo: "glob", token: "tkn" });
    const doc = window.document;
    setVal(doc, "f-url", "https://open.spotify.com/track/abc123");
    assert.strictEqual(doc.querySelector('[data-type="music"]').classList.contains("active"), true);
  });

  await check("pasting an unrecognized URL leaves the currently-selected type alone", async () => {
    const { window } = await run(async () => ({ ok: true, json: async () => ({}) }), { user: "jaschro", repo: "glob", token: "tkn" });
    const doc = window.document;
    doc.querySelector('[data-type="powerbi"]').dispatchEvent(new window.Event("click", { bubbles: true }));
    setVal(doc, "f-url", "https://example.com/some-random-page");
    assert.strictEqual(doc.querySelector('[data-type="powerbi"]').classList.contains("active"), true);
  });

  await check("opening a mistyped post (YouTube URL saved as tweet) for editing auto-corrects the type", async () => {
    const rawWrongType = [
      "---",
      'title: "Life is Life"',
      "date: 2026-08-16",
      "type: tweet",
      'categories: ["Music"]',
      'source_url: "https://www.youtube.com/watch?v=pATX-lV0VFk"',
      "---",
      "",
      ""
    ].join("\n");
    const editUrl = "https://jaschro.github.io/glob/add/?edit=2026-08-16-life-is-life.md";
    const mockFetch = (url, opts) => {
      if (!opts || !opts.method) {
        return { ok: true, json: async () => ({ content: Buffer.from(rawWrongType, "utf8").toString("base64"), sha: "sha1" }) };
      }
      return { ok: true, json: async () => ({}) };
    };
    const { window } = await run(mockFetch, { user: "jaschro", repo: "glob", token: "tkn" }, editUrl);
    const doc = window.document;
    assert.strictEqual(doc.querySelector('[data-type="youtube"]').classList.contains("active"), true, "should self-correct from tweet to youtube");
    assert.strictEqual(doc.getElementById("f-url").value, "https://www.youtube.com/watch?v=pATX-lV0VFk");
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

  await check("Save on Settings refuses to leave with an incomplete PAT (the reported bounce-back bug)", async () => {
    const { window } = await run(async () => ({ ok: true, json: async () => ({}) }));
    const doc = window.document;
    setVal(doc, "cfg-user", "jaschro");
    setVal(doc, "cfg-repo", "glob");
    // token left blank on purpose
    doc.getElementById("settings-save").dispatchEvent(new window.Event("click", { bubbles: true }));
    assert.strictEqual(doc.getElementById("screen-settings").classList.contains("on"), true, "should stay on Settings, not silently reveal the Add screen");
    assert.strictEqual(doc.getElementById("screen-main").classList.contains("on"), false);
    assert.ok(doc.getElementById("settings-status").textContent.includes("Fill in all three fields"));
  });

  await check("the Settings back link also refuses to leave with an incomplete PAT", async () => {
    const { window } = await run(async () => ({ ok: true, json: async () => ({}) }));
    const doc = window.document;
    setVal(doc, "cfg-user", "jaschro");
    // repo and token left blank
    doc.getElementById("settings-done").dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
    assert.strictEqual(doc.getElementById("screen-settings").classList.contains("on"), true);
  });

  await check('"+Add" gear icon (?settings=1) opens Settings directly even when a PAT is already saved', async () => {
    const { window } = await run(
      async () => ({ ok: true, json: async () => ({}) }),
      { user: "jaschro", repo: "glob", token: "tkn" },
      "https://jaschro.github.io/glob/add/?settings=1"
    );
    const doc = window.document;
    assert.strictEqual(doc.getElementById("screen-settings").classList.contains("on"), true);
    assert.strictEqual(doc.getElementById("cfg-user").value, "jaschro");
  });

  await check("Test connection reports success and write access", async () => {
    const { window } = await run(
      async () => ({ ok: true, json: async () => ({ permissions: { push: true } }) }),
      { user: "jaschro", repo: "glob", token: "tkn" }
    );
    const doc = window.document;
    doc.getElementById("gear").dispatchEvent(new window.Event("click", { bubbles: true }));
    doc.getElementById("test-connection").dispatchEvent(new window.Event("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(doc.getElementById("settings-status").textContent.includes("Connected"));
    assert.ok(doc.getElementById("settings-status").textContent.includes("can save posts"));
  });

  await check("Test connection reports read-only access separately from a hard failure", async () => {
    const { window } = await run(
      async () => ({ ok: true, json: async () => ({ permissions: { push: false } }) }),
      { user: "jaschro", repo: "glob", token: "tkn" }
    );
    const doc = window.document;
    doc.getElementById("gear").dispatchEvent(new window.Event("click", { bubbles: true }));
    doc.getElementById("test-connection").dispatchEvent(new window.Event("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(doc.getElementById("settings-status").textContent.includes("can't write to it"));
  });

  await check("Test connection surfaces the real GitHub error on failure", async () => {
    const { window } = await run(
      async () => ({ ok: false, status: 404, json: async () => ({ message: "Not Found" }) }),
      { user: "jaschro", repo: "glob", token: "tkn" }
    );
    const doc = window.document;
    doc.getElementById("gear").dispatchEvent(new window.Event("click", { bubbles: true }));
    doc.getElementById("test-connection").dispatchEvent(new window.Event("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(doc.getElementById("settings-status").textContent.includes("Not Found"));
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

  await check("a successful add shows a direct View post link, not just a wait-and-see message", async () => {
    const { window } = await run(async () => ({ ok: true, json: async () => ({}) }), { user: "jaschro", repo: "glob", token: "tkn123" });
    const doc = window.document;
    setVal(doc, "f-title", "Life is Life");
    setVal(doc, "f-category", "Music");
    submit(doc);
    await new Promise((r) => setTimeout(r, 30));
    const statusHtml = doc.getElementById("status").innerHTML;
    assert.ok(statusHtml.includes("View post"));
    assert.ok(statusHtml.includes("posts/"), "link should point at the new post's actual URL");
  });

  await check("a duplicate-title collision gets a clear explanation, not the raw GitHub 'sha' error", async () => {
    const { window } = await run(
      async () => ({ ok: false, status: 422, json: async () => ({ message: 'Invalid request.\n\n"sha" wasn\'t supplied.' }) }),
      { user: "jaschro", repo: "glob", token: "tkn123" }
    );
    const doc = window.document;
    setVal(doc, "f-title", "Life is Life");
    setVal(doc, "f-category", "Music");
    submit(doc);
    await new Promise((r) => setTimeout(r, 30));
    const statusHtml = doc.getElementById("status").innerHTML;
    assert.ok(statusHtml.includes("already exists"));
    assert.ok(statusHtml.includes("Check the existing post"));
    assert.ok(!statusHtml.includes('"sha" wasn'), 'raw GitHub API wording should not leak through');
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
    assert.strictEqual(doc.getElementById("submit-btn").textContent, "Save");
    assert.strictEqual(doc.getElementById("danger-zone").classList.contains("hidden"), false);
    assert.ok(doc.title.toLowerCase().includes("edit"), 'tab title should say "Edit post", not "Add to Glob"');
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
    assert.strictEqual(doc.getElementById("danger-zone").classList.contains("hidden"), true);
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

  await check("a failed post load shows a clear, unmissable error -- not a silent blank Add screen", async () => {
    const failingFetch = (url, opts) => {
      if (!opts || !opts.method) {
        return { ok: false, status: 401, json: async () => ({ message: "Bad credentials" }) };
      }
      return { ok: true, json: async () => ({}) };
    };
    const { window } = await run(failingFetch, { user: "jaschro", repo: "glob", token: "bad" }, EDIT_URL);
    const doc = window.document;
    assert.ok(doc.getElementById("form-heading").textContent.toLowerCase().includes("couldn't load"));
    assert.ok(doc.getElementById("status").textContent.includes("Bad credentials"));
    assert.strictEqual(doc.getElementById("danger-zone").classList.contains("hidden"), true);
    // Stays disabled and still says "Save", never "Add to Glob" -- seeing the
    // add-flow label after clicking Edit is exactly the confusing state we're
    // fixing, and a re-enabled button here would let a failed load silently
    // create a brand-new post instead of failing safely.
    assert.strictEqual(doc.getElementById("submit-btn").disabled, true);
    assert.strictEqual(doc.getElementById("submit-btn").textContent, "Save");
    assert.ok(!doc.title.includes("Add to Glob"), 'tab title should not say "Add to Glob" while editing');
  });

  await check("submitting is blocked (not silently creating a new post) if the edit target never loaded", async () => {
    const failingFetch = (url, opts) => {
      if (!opts || !opts.method) {
        return { ok: false, status: 401, json: async () => ({ message: "Bad credentials" }) };
      }
      return { ok: true, json: async () => ({}) };
    };
    const { window, getRequests } = await run(failingFetch, { user: "jaschro", repo: "glob", token: "bad" }, EDIT_URL);
    const doc = window.document;
    // Force a submit even though the button is disabled, to prove the JS-level
    // guard (not just the disabled attribute) is what's actually stopping this.
    setVal(doc, "f-title", "Should not be created");
    setVal(doc, "f-category", "Test");
    submit(doc);
    await new Promise((r) => setTimeout(r, 30));
    const reqs = getRequests();
    assert.strictEqual(reqs.length, 1, "only the original failed GET should have happened -- no PUT");
    assert.ok(doc.getElementById("status").textContent.includes("hasn't loaded"));
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
