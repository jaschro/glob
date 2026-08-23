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
            { title: "a", categories: ["Technology"], tags: ["AI", "prompting"] },
            { title: "b", categories: ["Music"], tags: ["Live Sets"] }
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

  await check("category datalist populates from the live post index", async () => {
    const { window } = await run(async () => ({ ok: true, json: async () => ({}) }), { user: "jaschro", repo: "glob", token: "tkn" });
    const cats = Array.from(window.document.getElementById("category-list").options).map((o) => o.value);
    assert.deepStrictEqual(cats.sort(), ["Music", "Technology"]);
  });

  // --- no type buttons: the type is derived from what you entered ---

  await check("the form has no content-type buttons at all", async () => {
    const { window } = await run(async () => ({ ok: true, json: async () => ({}) }), { user: "jaschro", repo: "glob", token: "tkn" });
    const doc = window.document;
    assert.strictEqual(doc.querySelectorAll("[data-type]").length, 0);
    assert.strictEqual(doc.getElementById("type-grid"), null);
  });

  await check("link and body fields are always visible -- nothing to switch on first", async () => {
    const { window } = await run(async () => ({ ok: true, json: async () => ({}) }), { user: "jaschro", repo: "glob", token: "tkn" });
    const doc = window.document;
    assert.strictEqual(doc.getElementById("url-field").classList.contains("hidden"), false);
    assert.strictEqual(doc.getElementById("body-field").classList.contains("hidden"), false);
  });

  await check("email details stay folded away until there's something in them", async () => {
    const { window } = await run(async () => ({ ok: true, json: async () => ({}) }), { user: "jaschro", repo: "glob", token: "tkn" });
    assert.strictEqual(window.document.getElementById("email-fields").open, false);
  });

  // Each of these saves the SAME form, changing only what was typed, and
  // asserts the frontmatter type the site needs came out right on its own.
  async function typeFor(fillFn) {
    const { window, getRequest } = await run(async () => ({ ok: true, json: async () => ({}) }), { user: "jaschro", repo: "glob", token: "tkn" });
    const doc = window.document;
    setVal(doc, "f-title", "Whatever");
    setVal(doc, "f-category", "General");
    fillFn(doc);
    submit(doc);
    await new Promise((r) => setTimeout(r, 30));
    const decoded = Buffer.from(JSON.parse(getRequest().opts.body).content, "base64").toString("utf8");
    return (decoded.match(/^type: (.+)$/m) || [])[1];
  }

  await check("a YouTube link saves as a youtube post without being told", async () => {
    assert.strictEqual(await typeFor((d) => setVal(d, "f-url", "https://www.youtube.com/watch?v=ncYOVGrbHwo")), "youtube");
  });

  await check("an x.com link saves as a tweet without being told", async () => {
    assert.strictEqual(await typeFor((d) => setVal(d, "f-url", "https://x.com/someone/status/123")), "tweet");
  });

  await check("a Spotify link saves as music without being told", async () => {
    assert.strictEqual(await typeFor((d) => setVal(d, "f-url", "https://open.spotify.com/track/abc")), "music");
  });

  await check("a PowerBI link saves as powerbi without being told", async () => {
    assert.strictEqual(await typeFor((d) => setVal(d, "f-url", "https://app.powerbi.com/view?r=abc")), "powerbi");
  });

  await check("an unrecognised link saves as a plain link, not a broken embed", async () => {
    assert.strictEqual(await typeFor((d) => setVal(d, "f-url", "https://example.com/an-article")), "link");
  });

  await check("body text with no link saves as a plain post", async () => {
    assert.strictEqual(await typeFor((d) => setVal(d, "f-body", "Just something I wrote.")), "post");
  });

  await check("filling in the email details makes it an email post", async () => {
    assert.strictEqual(await typeFor((d) => {
      setVal(d, "f-email-from", "billing@utilityco.example");
      setVal(d, "f-body", "The charge was reversed.");
    }), "email");
  });

  // --- tags ---

  await check("tags are parsed from the comma list, trimmed and de-duplicated", async () => {
    const { window, getRequest } = await run(async () => ({ ok: true, json: async () => ({}) }), { user: "jaschro", repo: "glob", token: "tkn" });
    const doc = window.document;
    setVal(doc, "f-title", "Tagged");
    setVal(doc, "f-category", "General");
    setVal(doc, "f-body", "Body.");
    setVal(doc, "f-tags", "  funny ,, nostalgia,funny , video ");
    submit(doc);
    await new Promise((r) => setTimeout(r, 30));
    const decoded = Buffer.from(JSON.parse(getRequest().opts.body).content, "base64").toString("utf8");
    assert.ok(decoded.includes('tags: ["funny","nostalgia","video"]'), "got: " + decoded.split("\n")[4]);
  });

  await check("no tags means no tags line in the frontmatter at all", async () => {
    const { window, getRequest } = await run(async () => ({ ok: true, json: async () => ({}) }), { user: "jaschro", repo: "glob", token: "tkn" });
    const doc = window.document;
    setVal(doc, "f-title", "Untagged");
    setVal(doc, "f-category", "General");
    setVal(doc, "f-body", "Body.");
    submit(doc);
    await new Promise((r) => setTimeout(r, 30));
    const decoded = Buffer.from(JSON.parse(getRequest().opts.body).content, "base64").toString("utf8");
    assert.ok(!decoded.includes("tags:"));
  });

  await check("tags already in use appear as one-tap chips", async () => {
    const { window } = await run(async () => ({ ok: true, json: async () => ({}) }), { user: "jaschro", repo: "glob", token: "tkn" });
    const doc = window.document;
    const chips = Array.from(doc.querySelectorAll("#tag-suggestions button")).map((b) => b.textContent);
    assert.deepStrictEqual(chips, ["AI", "Live Sets", "prompting"]);
  });

  await check("tapping a chip adds the tag, tapping again removes it", async () => {
    const { window } = await run(async () => ({ ok: true, json: async () => ({}) }), { user: "jaschro", repo: "glob", token: "tkn" });
    const doc = window.document;
    const chip = Array.from(doc.querySelectorAll("#tag-suggestions button")).find((b) => b.textContent === "AI");
    chip.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    assert.strictEqual(doc.getElementById("f-tags").value, "AI");
    assert.strictEqual(chip.classList.contains("on"), true);
    chip.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    assert.strictEqual(doc.getElementById("f-tags").value, "");
    assert.strictEqual(chip.classList.contains("on"), false);
  });

  // --- formatting toolbar ---
  function fmtSetup(doc, window, text, selStart, selEnd) {
    const ta = doc.getElementById("f-body");
    ta.value = text;
    ta.setSelectionRange(selStart, selEnd === undefined ? selStart : selEnd);
    return ta;
  }
  function clickFmt(doc, window, fmt) {
    doc.querySelector('.fmt-bar[data-for="f-body"] [data-fmt="' + fmt + '"]')
      .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  }

  await check("Bold button wraps the selected text in markdown bold", async () => {
    const { window } = await run(async () => ({ ok: true, json: async () => ({}) }), { user: "jaschro", repo: "glob", token: "tkn" });
    const doc = window.document;
    const ta = fmtSetup(doc, window, "make this bold", 10, 14);
    clickFmt(doc, window, "bold");
    assert.strictEqual(ta.value, "make this **bold**");
  });

  await check("Italic and Underline wrap correctly (underline uses raw HTML)", async () => {
    const { window } = await run(async () => ({ ok: true, json: async () => ({}) }), { user: "jaschro", repo: "glob", token: "tkn" });
    const doc = window.document;
    let ta = fmtSetup(doc, window, "hello world", 6, 11);
    clickFmt(doc, window, "italic");
    assert.strictEqual(ta.value, "hello *world*");
    ta.value = "hello world";
    ta.setSelectionRange(6, 11);
    clickFmt(doc, window, "underline");
    assert.strictEqual(ta.value, "hello <u>world</u>");
  });

  await check("Bullet button turns each selected line into a list item", async () => {
    const { window } = await run(async () => ({ ok: true, json: async () => ({}) }), { user: "jaschro", repo: "glob", token: "tkn" });
    const doc = window.document;
    const text = "Ice cream\nPizza\nProrasso";
    const ta = fmtSetup(doc, window, text, 0, text.length);
    clickFmt(doc, window, "bullet");
    assert.strictEqual(ta.value, "- Ice cream\n- Pizza\n- Prorasso");
  });

  await check("Bullet button doesn't double-prefix lines that are already bullets", async () => {
    const { window } = await run(async () => ({ ok: true, json: async () => ({}) }), { user: "jaschro", repo: "glob", token: "tkn" });
    const doc = window.document;
    const text = "- Already\nPlain";
    const ta = fmtSetup(doc, window, text, 0, text.length);
    clickFmt(doc, window, "bullet");
    assert.strictEqual(ta.value, "- Already\n- Plain");
  });

  await check("Numbered list numbers the selected lines sequentially", async () => {
    const { window } = await run(async () => ({ ok: true, json: async () => ({}) }), { user: "jaschro", repo: "glob", token: "tkn" });
    const doc = window.document;
    const text = "First\nSecond\nThird";
    const ta = fmtSetup(doc, window, text, 0, text.length);
    clickFmt(doc, window, "number");
    assert.strictEqual(ta.value, "1. First\n2. Second\n3. Third");
  });

  await check("Indent nests a list item, but never creates a 4-space code block from plain text", async () => {
    const { window } = await run(async () => ({ ok: true, json: async () => ({}) }), { user: "jaschro", repo: "glob", token: "tkn" });
    const doc = window.document;
    // list item -> nested with two spaces
    let ta = fmtSetup(doc, window, "- a list item", 0, 13);
    clickFmt(doc, window, "indent");
    assert.strictEqual(ta.value, "  - a list item");
    // plain text -> blockquote, not leading spaces (4 spaces would become code)
    ta.value = "just some text";
    ta.setSelectionRange(0, 14);
    clickFmt(doc, window, "indent");
    assert.strictEqual(ta.value, "> just some text");
    // pressing it twice on plain text still must not produce leading spaces
    ta.setSelectionRange(0, ta.value.length);
    clickFmt(doc, window, "indent");
    assert.ok(!/^ {4}/.test(ta.value), "must never start a line with 4 spaces");
  });

  await check("formatting applied in the body survives into the saved post content", async () => {
    const { window, getRequest } = await run(async () => ({ ok: true, json: async () => ({}) }), { user: "jaschro", repo: "glob", token: "tkn" });
    const doc = window.document;
    const text = "Ice cream\nPizza";
    const ta = fmtSetup(doc, window, text, 0, text.length);
    clickFmt(doc, window, "bullet");
    setVal(doc, "f-title", "Five things I like");
    setVal(doc, "f-category", "General");
    submit(doc);
    await new Promise((r) => setTimeout(r, 30));
    const body = JSON.parse(getRequest().opts.body);
    const decoded = Buffer.from(body.content, "base64").toString("utf8");
    assert.ok(decoded.includes("- Ice cream\n- Pizza"));
  });

  await check("a link and body text can go in the same post", async () => {
    const { window, getRequest } = await run(async () => ({ ok: true, json: async () => ({}) }), { user: "jaschro", repo: "glob", token: "tkn" });
    const doc = window.document;
    setVal(doc, "f-title", "Rappers Delight");
    setVal(doc, "f-category", "Music");
    setVal(doc, "f-url", "https://www.youtube.com/watch?v=ncYOVGrbHwo");
    setVal(doc, "f-body", "Worth it for the chef.\n\nhttps://youtu.be/pATX-lV0VFk");
    submit(doc);
    await new Promise((r) => setTimeout(r, 30));
    const decoded = Buffer.from(JSON.parse(getRequest().opts.body).content, "base64").toString("utf8");
    assert.ok(decoded.includes('source_url: "https://www.youtube.com/watch?v=ncYOVGrbHwo"'));
    assert.ok(decoded.includes("Worth it for the chef."));
    assert.ok(decoded.includes("https://youtu.be/pATX-lV0VFk"),
      "a second link in the body is kept verbatim so the site can embed it too");
  });

  await check("saving with nothing but a title and category is refused", async () => {
    const { window, getRequest } = await run(async () => { throw new Error("must not be called"); }, { user: "jaschro", repo: "glob", token: "tkn" });
    const doc = window.document;
    setVal(doc, "f-title", "Empty");
    setVal(doc, "f-category", "General");
    submit(doc);
    await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(getRequest(), null);
    assert.ok(doc.getElementById("status").textContent.includes("nothing to save"));
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
    setVal(doc, "f-tags", "AI, prompting");
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
    assert.ok(decoded.includes('tags: ["AI","prompting"]'));
    assert.ok(decoded.includes('source_url: "https://twitter.com/x/status/123"'));
    assert.strictEqual(doc.getElementById("f-title").value, "", "form should reset after success");
  });

  await check("a successful add shows a direct View post link, not just a wait-and-see message", async () => {
    const { window } = await run(async () => ({ ok: true, json: async () => ({}) }), { user: "jaschro", repo: "glob", token: "tkn123" });
    const doc = window.document;
    setVal(doc, "f-title", "Life is Life");
    setVal(doc, "f-category", "Music");
    setVal(doc, "f-url", "https://youtu.be/pATX-lV0VFk");
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
    setVal(doc, "f-url", "https://youtu.be/pATX-lV0VFk");
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
    setVal(doc, "f-title", "Utility note");
    setVal(doc, "f-category", "Personal");
    setVal(doc, "f-email-from", "billing@utilityco.example");
    setVal(doc, "f-body", "The charge was reversed.");
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
    setVal(doc, "f-body", "Some body text.");
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
    setVal(doc, "f-body", "Some body text.");
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
    setVal(doc, "f-body", "Worth reading for the third reply.");
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
    setVal(doc, "f-title", "A written post");
    setVal(doc, "f-category", "Journal");
    setVal(doc, "f-body", "This is the full text of a normal blog post.");
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

  await check("image links follow the site root, so they survive a move to a custom domain", async () => {
    // Same flow as above but served from a domain root instead of /glob/.
    // Hardcoding "/glob/images/" here would 404 every image after the move.
    const { window, getRequests } = await run(
      async () => ({ ok: true, json: async () => ({}) }),
      { user: "jaschro", repo: "glob", token: "tkn" },
      "https://www.example.com/add/"
    );
    const doc = window.document;
    setVal(doc, "f-title", "Photo post");
    setVal(doc, "f-category", "Personal");
    setFiles(doc, "f-images", [new window.File(["bytes"], "cat.png", { type: "image/png" })]);
    submit(doc);
    await new Promise((r) => setTimeout(r, 60));
    const reqs = getRequests();
    const decoded = Buffer.from(JSON.parse(reqs[reqs.length - 1].opts.body).content, "base64").toString("utf8");
    assert.ok(decoded.includes("![](/images/"), "expected a root-relative image path");
    assert.ok(!decoded.includes("/glob/"), "the github.io subpath must not leak onto a custom domain");
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
    assert.strictEqual(doc.getElementById("f-tags").value, "Admin",
      "a legacy subcategory should load into the tags field so re-saving converts it");
    assert.strictEqual(doc.getElementById("f-email-from").value, "billing@utilityco.example");
    assert.ok(doc.getElementById("f-body").value.includes("duplicate charge has been reversed"));
    assert.strictEqual(doc.getElementById("email-fields").classList.contains("hidden"), false);
    assert.strictEqual(doc.getElementById("submit-btn").textContent, "Save");
    assert.strictEqual(doc.getElementById("danger-zone").classList.contains("hidden"), false);
    assert.ok(doc.title.toLowerCase().includes("edit"), 'tab title should say "Edit post", not "Add to Glob"');
  });

  await check("saving an edited post PUTs to the original path with the original sha", async () => {
    const { window, getRequests } = await run(mockGetExisting, { user: "jaschro", repo: "glob", token: "tkn" }, EDIT_URL);
    const doc = window.document;
    setVal(doc, "f-body", "Thanks for confirming -- updated text.");
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
    setVal(doc, "f-body", "Some body text.");
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
    setVal(doc, "f-body", "Some body text.");
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
