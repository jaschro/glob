(function () {
  "use strict";

  var root = document.getElementById("browse-root");
  if (!root) return;

  var els = {
    categoryTree: document.getElementById("category-tree"),
    tagTree: document.getElementById("tag-tree"),
    dateTree: document.getElementById("date-tree"),
    results: document.getElementById("browse-results"),
    empty: document.getElementById("browse-empty"),
    emptyClearBtn: document.getElementById("empty-clear-btn"),
    status: document.getElementById("browse-status"),
    searchForm: document.getElementById("browse-search-form"),
    searchInput: document.getElementById("browse-search-input"),
    clearAllBtn: document.getElementById("clear-all"),
    categoryClearBtn: document.querySelector('[data-clear="category"]'),
    tagClearBtn: document.querySelector('[data-clear="tag"]'),
    dateClearBtn: document.querySelector('[data-clear="date"]')
  };

  // Plain .sort() is ASCII-ordered, which puts every capitalised name above
  // every lowercase one ("Snapshots" before "prompting"). Tags get typed both
  // ways, so compare case-insensitively or the list looks shuffled.
  function byName(a, b) {
    return a.toLowerCase().localeCompare(b.toLowerCase());
  }

  var MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  var state = readStateFromURL();
  var allItems = [];

  fetch(root.getAttribute("data-json-url"))
    .then(function (res) {
      if (!res.ok) throw new Error("Fetch failed: " + res.status);
      return res.json();
    })
    .then(function (data) {
      allItems = Array.isArray(data) ? data : [];
      buildCategoryTree(allItems);
      buildTagTree(allItems);
      buildDateTree(allItems);
      if (els.searchInput) els.searchInput.value = state.q || "";
      render();
    })
    .catch(function (err) {
      // Fail gracefully -- never leave the page looking broken.
      if (els.status) {
        els.status.textContent = "Couldn't load posts right now. Try refreshing.";
      }
      if (els.categoryTree) els.categoryTree.innerHTML = "";
      if (els.tagTree) els.tagTree.innerHTML = "";
      if (els.dateTree) els.dateTree.innerHTML = "";
      console.error(err);
    });

  function readStateFromURL() {
    var params = new URLSearchParams(window.location.search);
    // Several tags can be active at once and they narrow together, so they
    // travel in the URL as one comma-separated value: ?tags=funny,video
    var rawTags = params.get("tags") || "";
    return {
      category: params.get("category") || "",
      tags: rawTags ? rawTags.split(",").map(function (t) { return t.trim(); }).filter(Boolean) : [],
      year: params.get("year") || "",
      month: params.get("month") || "",
      q: params.get("q") || ""
    };
  }

  function writeStateToURL() {
    var params = new URLSearchParams();
    if (state.category) params.set("category", state.category);
    if (state.tags.length) params.set("tags", state.tags.join(","));
    if (state.year) params.set("year", state.year);
    if (state.month) params.set("month", state.month);
    if (state.q) params.set("q", state.q);
    var qs = params.toString();
    var newURL = window.location.pathname + (qs ? "?" + qs : "");
    window.history.replaceState(null, "", newURL);
  }

  function buildCategoryTree(items) {
    if (!els.categoryTree) return;
    var counts = {};

    items.forEach(function (item) {
      (item.categories || []).forEach(function (cat) {
        counts[cat] = (counts[cat] || 0) + 1;
      });
    });

    var catNames = Object.keys(counts).sort(byName);
    els.categoryTree.innerHTML = "";

    if (catNames.length === 0) {
      els.categoryTree.innerHTML = '<li class="filter-tree-empty">No categories yet</li>';
      return;
    }

    catNames.forEach(function (cat) {
      var li = document.createElement("li");
      li.appendChild(makeFilterLink(cat + " (" + counts[cat] + ")", cat === state.category, function () {
        // One category at a time -- clicking the active one clears it.
        state.category = (state.category === cat) ? "" : cat;
        afterFilterChange();
      }));
      els.categoryTree.appendChild(li);
    });
  }

  // Tags are flat and stack: picking two shows only posts carrying both,
  // which is what makes them useful for narrowing across categories.
  function buildTagTree(items) {
    if (!els.tagTree) return;
    var counts = {};

    items.forEach(function (item) {
      (item.tags || []).forEach(function (tag) {
        counts[tag] = (counts[tag] || 0) + 1;
      });
    });

    var tagNames = Object.keys(counts).sort(byName);
    els.tagTree.innerHTML = "";

    if (tagNames.length === 0) {
      els.tagTree.innerHTML = '<li class="filter-tree-empty">No tags yet</li>';
      return;
    }

    tagNames.forEach(function (tag) {
      var li = document.createElement("li");
      var active = state.tags.indexOf(tag) !== -1;
      li.appendChild(makeFilterLink(tag + " (" + counts[tag] + ")", active, function () {
        var i = state.tags.indexOf(tag);
        if (i === -1) state.tags.push(tag);
        else state.tags.splice(i, 1);
        afterFilterChange();
      }));
      els.tagTree.appendChild(li);
    });
  }

  function buildDateTree(items) {
    if (!els.dateTree) return;
    var tree = {}; // year -> { count, months: { month -> count } }

    items.forEach(function (item) {
      if (!item.date) return;
      var parts = item.date.split("-");
      var year = parts[0];
      var month = parts[1];
      if (!tree[year]) tree[year] = { count: 0, months: {} };
      tree[year].count++;
      tree[year].months[month] = (tree[year].months[month] || 0) + 1;
    });

    var years = Object.keys(tree).sort().reverse();
    els.dateTree.innerHTML = "";

    if (years.length === 0) {
      els.dateTree.innerHTML = '<li class="filter-tree-empty">No dated items yet</li>';
      return;
    }

    years.forEach(function (year) {
      var li = document.createElement("li");
      var link = makeFilterLink(year + " (" + tree[year].count + ")", year === state.year && !state.month,
        function () {
          state.year = (state.year === year && !state.month) ? "" : year;
          state.month = "";
          afterFilterChange();
        });
      li.appendChild(link);

      var months = Object.keys(tree[year].months).sort();
      if (months.length > 1) {
        var monthUl = document.createElement("ul");
        monthUl.className = "filter-subtree";
        months.forEach(function (month) {
          var label = (MONTH_NAMES[parseInt(month, 10) - 1] || month) + " (" + tree[year].months[month] + ")";
          var active = state.year === year && state.month === month;
          var monthLink = makeFilterLink(label, active, function () {
            if (state.year === year && state.month === month) {
              state.year = "";
              state.month = "";
            } else {
              state.year = year;
              state.month = month;
            }
            afterFilterChange();
          });
          var monthLi = document.createElement("li");
          monthLi.appendChild(monthLink);
          monthUl.appendChild(monthLi);
        });
        li.appendChild(monthUl);
      }

      els.dateTree.appendChild(li);
    });
  }

  function makeFilterLink(label, active, onClick) {
    var a = document.createElement("a");
    a.href = "#";
    a.textContent = label;
    a.className = "filter-link" + (active ? " active" : "");
    a.addEventListener("click", function (e) {
      e.preventDefault();
      onClick();
    });
    return a;
  }

  function afterFilterChange() {
    writeStateToURL();
    buildCategoryTree(allItems);
    buildTagTree(allItems);
    buildDateTree(allItems);
    render();
  }

  function matches(item) {
    if (state.category) {
      var cats = item.categories || [];
      if (cats.indexOf(state.category) === -1) return false;
    }
    if (state.tags.length) {
      // Every selected tag must be present -- tags narrow, they don't widen.
      var itemTags = item.tags || [];
      for (var i = 0; i < state.tags.length; i++) {
        if (itemTags.indexOf(state.tags[i]) === -1) return false;
      }
    }
    if (state.year) {
      var itemYear = (item.date || "").split("-")[0];
      if (itemYear !== state.year) return false;
    }
    if (state.month) {
      var itemMonth = (item.date || "").split("-")[1];
      if (itemMonth !== state.month) return false;
    }
    if (state.q) {
      var needle = state.q.toLowerCase();
      // item.text is the post's body copy (plus sender/subject on emails),
      // supplied by layouts/posts/list.json -- without it, search only ever
      // matched titles and metadata.
      var haystack = [item.title, item.type, item.text]
        .concat(item.categories || [])
        .concat(item.tags || [])
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (haystack.indexOf(needle) === -1) return false;
    }
    return true;
  }

  // Builds a short excerpt around the search term so a result that matched
  // on body text shows *why* it matched, instead of looking like an
  // unrelated title. Returns null when the body doesn't contain the term
  // (e.g. it matched on the title), in which case no excerpt is shown.
  function makeSnippet(text, q) {
    if (!text || !q) return null;
    var idx = text.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) return null;
    var pad = 60;
    var start = Math.max(0, idx - pad);
    var end = Math.min(text.length, idx + q.length + pad);
    return {
      before: (start > 0 ? "…" : "") + text.slice(start, idx),
      match: text.slice(idx, idx + q.length),
      after: text.slice(idx + q.length, end) + (end < text.length ? "…" : "")
    };
  }

  function render() {
    var filtered = allItems.filter(matches);

    toggleClearButtons();

    if (els.status) {
      var count = filtered.length;
      els.status.textContent = allItems.length
        ? (count + " item" + (count === 1 ? "" : "s"))
        : "";
    }

    if (!els.results) return;
    els.results.innerHTML = "";

    if (filtered.length === 0) {
      els.results.hidden = true;
      if (els.empty) els.empty.hidden = false;
      return;
    }

    if (els.empty) els.empty.hidden = true;
    els.results.hidden = false;

    filtered.forEach(function (item) {
      var li = document.createElement("li");
      li.className = "post-stream-item";

      var time = document.createElement("time");
      time.setAttribute("datetime", item.date || "");
      time.textContent = formatDate(item.date);
      li.appendChild(time);

      var a = document.createElement("a");
      a.href = item.url;
      a.textContent = item.title;
      li.appendChild(a);

      if (state.q) {
        var snip = makeSnippet(item.text, state.q);
        if (snip) {
          var p = document.createElement("p");
          p.className = "result-snippet";
          // Built from text nodes, never innerHTML -- post content is
          // arbitrary text and must not be interpreted as markup here.
          p.appendChild(document.createTextNode(snip.before));
          var mark = document.createElement("mark");
          mark.textContent = snip.match;
          p.appendChild(mark);
          p.appendChild(document.createTextNode(snip.after));
          li.appendChild(p);
        }
      }

      els.results.appendChild(li);
    });
  }

  function toggleClearButtons() {
    var anyCategory = !!state.category;
    var anyTag = state.tags.length > 0;
    var anyDate = !!(state.year || state.month);
    var any = anyCategory || anyTag || anyDate || !!state.q;

    if (els.categoryClearBtn) els.categoryClearBtn.hidden = !anyCategory;
    if (els.tagClearBtn) els.tagClearBtn.hidden = !anyTag;
    if (els.dateClearBtn) els.dateClearBtn.hidden = !anyDate;
    if (els.clearAllBtn) els.clearAllBtn.hidden = !any;
  }

  function formatDate(iso) {
    if (!iso) return "";
    var parts = iso.split("-");
    if (parts.length !== 3) return iso;
    var month = MONTH_NAMES[parseInt(parts[1], 10) - 1] || parts[1];
    return month + " " + parseInt(parts[2], 10) + ", " + parts[0];
  }

  function clearCategory() {
    state.category = "";
    afterFilterChange();
  }

  function clearTags() {
    state.tags = [];
    afterFilterChange();
  }

  function clearDate() {
    state.year = "";
    state.month = "";
    afterFilterChange();
  }

  function clearAll() {
    state.category = "";
    state.tags = [];
    state.year = "";
    state.month = "";
    state.q = "";
    if (els.searchInput) els.searchInput.value = "";
    afterFilterChange();
  }

  if (els.categoryClearBtn) els.categoryClearBtn.addEventListener("click", clearCategory);
  if (els.tagClearBtn) els.tagClearBtn.addEventListener("click", clearTags);
  if (els.dateClearBtn) els.dateClearBtn.addEventListener("click", clearDate);
  if (els.clearAllBtn) els.clearAllBtn.addEventListener("click", clearAll);
  if (els.emptyClearBtn) els.emptyClearBtn.addEventListener("click", clearAll);

  if (els.searchForm) {
    els.searchForm.addEventListener("submit", function (e) {
      e.preventDefault();
    });
  }
  if (els.searchInput) {
    els.searchInput.addEventListener("input", function () {
      state.q = els.searchInput.value.trim();
      writeStateToURL();
      render();
    });
  }
})();
