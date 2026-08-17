// Tests for static/js/browse.js (the Posts page sidebar filter/search logic).
// Run with: node tests/browse.test.js   (or `npm test` to run everything)
//
// These simulate a browser with jsdom and feed the real browse.js file
// synthetic post data, so a change to the filtering/rendering logic that
// breaks something will fail this before it ever reaches the live site.

const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = path.join(__dirname, "..");
const BROWSE_JS = fs.readFileSync(path.join(ROOT, "static/js/browse.js"), "utf8");

const SHELL = `<!DOCTYPE html><html><body>
<div class="browse" id="browse-root" data-json-url="http://localhost/posts/index.json">
  <aside class="browse-sidebar">
    <div class="filter-group">
      <div class="filter-group-header"><h2>Categories</h2>
        <button type="button" class="clear-link" data-clear="category" hidden>clear</button>
      </div>
      <ul class="filter-tree" id="category-tree"><li class="filter-tree-loading">Loading…</li></ul>
    </div>
    <div class="filter-group">
      <div class="filter-group-header"><h2>Dates</h2>
        <button type="button" class="clear-link" data-clear="date" hidden>clear</button>
      </div>
      <ul class="filter-tree" id="date-tree"><li class="filter-tree-loading">Loading…</li></ul>
    </div>
    <button type="button" id="clear-all" class="clear-all-btn" hidden>Clear all filters</button>
  </aside>
  <div class="browse-main">
    <header class="list-header browse-header">
      <h1>Posts</h1>
      <form class="browse-search" id="browse-search-form" role="search">
        <input type="search" id="browse-search-input" name="q" placeholder="Search posts…" aria-label="Search posts">
      </form>
    </header>
    <p class="browse-status" id="browse-status"></p>
    <ul class="post-stream" id="browse-results"></ul>
    <div class="empty-state" id="browse-empty" hidden>
      <p>Nothing matches these filters.</p>
      <button type="button" id="empty-clear-btn">Clear filters</button>
    </div>
  </div>
</div>
</body></html>`;

const FIXTURE = [
  { title: "A good thread on prompt design", url: "/glob/posts/1/", date: "2026-08-10", type: "tweet", categories: ["Technology"], subcategory: "AI" },
  { title: "Clear explainer on how CRDTs work", url: "/glob/posts/2/", date: "2026-08-12", type: "youtube", categories: ["Technology"], subcategory: "Distributed Systems" },
  { title: "Really good live set for working", url: "/glob/posts/3/", date: "2026-08-13", type: "music", categories: ["Music"], subcategory: "Live Sets" },
  { title: "Portfolio allocation snapshot", url: "/glob/posts/4/", date: "2026-08-14", type: "powerbi", categories: ["Investing"], subcategory: "Snapshots" },
  { title: "Note on the utility billing mixup", url: "/glob/posts/5/", date: "2026-08-15", type: "email", categories: ["Personal"], subcategory: "Admin" },
  { title: "Another AI thread from last year", url: "/glob/posts/6/", date: "2025-03-02", type: "tweet", categories: ["Technology"], subcategory: "AI" }
];

async function run(url, fetchImpl) {
  const dom = new JSDOM(SHELL, { url, runScripts: "outside-only", pretendToBeVisual: true });
  dom.window.fetch = fetchImpl || (async () => ({ ok: true, json: async () => FIXTURE }));
  dom.window.eval(BROWSE_JS);
  await new Promise((r) => setTimeout(r, 50));
  return dom.window;
}

function resultTitles(win) {
  return Array.from(win.document.querySelectorAll("#browse-results a")).map((a) => a.textContent);
}

let passed = 0;
function check(name, fn) {
  return fn().then(() => {
    passed++;
    console.log("  ok - " + name);
  });
}

async function main() {
  await check("no filters shows all posts", async () => {
    const win = await run("http://localhost/posts/");
    assert.strictEqual(win.document.querySelectorAll("#browse-results li").length, 6);
    assert.strictEqual(win.document.getElementById("browse-empty").hidden, true);
  });

  await check("search with no matches shows empty state, not an error", async () => {
    const win = await run("http://localhost/posts/?q=zzzznomatch");
    assert.strictEqual(win.document.querySelectorAll("#browse-results li").length, 0);
    assert.strictEqual(win.document.getElementById("browse-empty").hidden, false);
    assert.strictEqual(win.document.getElementById("browse-results").hidden, true);
  });

  await check("category filter narrows correctly", async () => {
    const win = await run("http://localhost/posts/?category=Technology");
    assert.deepStrictEqual(resultTitles(win), [
      "A good thread on prompt design",
      "Clear explainer on how CRDTs work",
      "Another AI thread from last year"
    ]);
  });

  await check("category+subcategory filter narrows further", async () => {
    const win = await run("http://localhost/posts/?category=Technology&subcategory=AI");
    assert.deepStrictEqual(resultTitles(win), [
      "A good thread on prompt design",
      "Another AI thread from last year"
    ]);
  });

  await check("year filter works", async () => {
    const win = await run("http://localhost/posts/?year=2025");
    assert.deepStrictEqual(resultTitles(win), ["Another AI thread from last year"]);
  });

  await check("impossible filter combo -> empty state, not a crash", async () => {
    const win = await run("http://localhost/posts/?category=Music&year=2025");
    assert.strictEqual(win.document.querySelectorAll("#browse-results li").length, 0);
    assert.strictEqual(win.document.getElementById("browse-empty").hidden, false);
  });

  await check("clicking a category link filters and updates the URL", async () => {
    const win = await run("http://localhost/posts/");
    const link = win.document.querySelector("#category-tree .filter-link");
    link.dispatchEvent(new win.Event("click", { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(win.location.search.includes("category="));
    assert.strictEqual(win.document.getElementById("clear-all").hidden, false);
  });

  await check("fetch failure shows a message and never throws uncaught", async () => {
    let threwUncaught = false;
    const dom = new JSDOM(SHELL, { url: "http://localhost/posts/", runScripts: "outside-only" });
    dom.window.onerror = () => { threwUncaught = true; };
    dom.window.fetch = async () => { throw new Error("network down"); };
    dom.window.eval(BROWSE_JS);
    await new Promise((r) => setTimeout(r, 50));
    assert.strictEqual(threwUncaught, false);
    assert.ok(dom.window.document.getElementById("browse-status").textContent.length > 0);
  });

  console.log(passed + " passed");
}

main().catch((err) => {
  console.error("FAIL:", err.message);
  process.exit(1);
});
