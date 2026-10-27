const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const DEFAULT_SITE = "http://localhost:8765";
const PAGE_SIZE = 100;
const HISTORY_MAX = 30;

let current = null;
let shown = PAGE_SIZE;
let busy = false;

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("show"), 2000);
}

const colorFor = (v, invert) => {
  const good = invert ? v < 40 : v >= 60;
  const mid = invert ? v < 65 : v >= 40;
  return good ? "var(--accent)" : mid ? "var(--warn)" : "var(--bad)";
};

// ------------------------------------------------------------ navigation

function go(view) {
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === view));
  $$(".view").forEach((v) => v.classList.toggle("hidden", v.id !== `view-${view}`));
  if (view === "history") loadHistory();
  window.scrollTo(0, 0);
}
$$(".tab").forEach((t) => t.addEventListener("click", () => go(t.dataset.view)));

// ------------------------------------------------------------ research

$("#research-form").addEventListener("submit", (e) => {
  e.preventDefault();
  runResearch($("#kw").value);
});

async function runResearch(keyword) {
  keyword = keyword.trim();
  if (!keyword || busy) return;
  busy = true;
  go("research");
  $("#kw").value = keyword;
  $("#error").textContent = "";
  $("#results").classList.add("hidden");
  $("#loading").classList.remove("hidden");
  $("#research-btn").disabled = true;
  $("#progress-bar").style.width = "0%";
  $("#progress-text").textContent = "";

  const opts = { gl: $("#country").value, hl: $("#language").value, depth: $("#depth").value };
  chrome.storage.local.set({ prefs: opts });
  try {
    const data = await research(keyword, opts, (done, total) => {
      $("#progress-bar").style.width = `${Math.round((done / total) * 100)}%`;
      $("#progress-text").textContent = `${done}/${total}`;
    });
    if (!data.keywords.length) throw new Error("Koi keyword nahi mila. Internet check karein ya doosra keyword try karein.");
    renderResults(data);
    saveHistory(data);
  } catch (err) {
    $("#error").textContent = err.message;
  } finally {
    busy = false;
    $("#loading").classList.add("hidden");
    $("#research-btn").disabled = false;
  }
}

function renderResults(data) {
  current = data;
  shown = PAGE_SIZE;
  const s = data.summary;
  $("#results").classList.remove("hidden");

  const ring = $("#score-ring");
  ring.style.setProperty("--p", s.niche_score);
  ring.style.setProperty("--c", colorFor(s.niche_score));
  $("#niche-score").textContent = s.niche_score;
  $("#verdict").textContent = `${s.verdict} niche`;
  $("#meta").textContent = `"${data.seed}" · ${data.country.toUpperCase()} · ${data.depth} · ${data.duration}s`;

  $("#stats").innerHTML = [
    ["Keywords", s.total], ["Easy", s.easy], ["Questions", s.questions],
    ["Long-tail", s.long_tail], ["Avg. Comp", s.avg_competition], ["Buying", s.intents.commercial + s.intents.transactional],
  ].map(([l, v]) => `<div class="stat"><b>${v}</b><small>${l}</small></div>`).join("");

  const colors = { informational: "#60a5fa", commercial: "#f59e0b", transactional: "#22c55e", navigational: "#c084fc" };
  $("#intents").innerHTML = Object.entries(s.intents).map(([k, v]) => {
    const pct = s.total ? Math.round((v / s.total) * 100) : 0;
    return `<div class="bar-row"><span>${k}</span><div class="bar"><i style="width:${pct}%;background:${colors[k]}"></i></div><small>${pct}%</small></div>`;
  }).join("");

  $("#modifiers").innerHTML = data.modifiers.map(([w, n]) =>
    `<span class="chip" data-kw="${esc(data.seed + " " + w)}">${esc(w)}<small>${n}</small></span>`).join("") || '<span class="muted">–</span>';

  $("#filter-text").value = "";
  $("#filter-type").value = "all";
  renderList();
}

$("#modifiers").addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (chip) runResearch(chip.dataset.kw);
});

function filteredKeywords() {
  if (!current) return [];
  const text = $("#filter-text").value.trim().toLowerCase();
  const type = $("#filter-type").value;
  const key = $("#sort").value;
  return current.keywords
    .filter((k) => {
      if (text && !k.keyword.includes(text)) return false;
      if (type === "easy") return k.difficulty === "Easy";
      if (type === "questions") return k.is_question;
      if (type === "longtail") return k.long_tail;
      if (type === "commercial") return k.intent === "commercial" || k.intent === "transactional";
      return true;
    })
    .sort((a, b) => {
      if (key === "keyword") return a.keyword.localeCompare(b.keyword);
      if (key === "competition") return a.competition - b.competition;
      return b[key] - a[key];
    });
}

function renderList() {
  const list = filteredKeywords();
  $("#kw-count").textContent = `(${list.length})`;
  const rows = list.slice(0, shown).map((k) => `
    <div class="kw-row">
      <div class="k">
        <a href="https://www.google.com/search?q=${encodeURIComponent(k.keyword)}" target="_blank" rel="noopener">${esc(k.keyword)}</a>
        <small class="${k.intent}">${k.intent} · ${k.difficulty}</small>
      </div>
      <span class="num" style="color:${colorFor(k.popularity)}">${k.popularity}</span>
      <span class="num" style="color:${colorFor(k.competition, true)}">${k.competition}</span>
      <span class="num" style="color:${colorFor(k.opportunity)}">${k.opportunity}</span>
    </div>`).join("");
  const more = list.length > shown ? `<button class="btn more" id="more-btn" type="button">Aur dikhayein (${list.length - shown})</button>` : "";
  $("#kw-list").innerHTML = (rows || '<p class="muted">Koi keyword match nahi hua</p>') + more;
}

$("#kw-list").addEventListener("click", (e) => {
  if (e.target.id === "more-btn") {
    shown += PAGE_SIZE;
    renderList();
  }
});
$("#filter-text").addEventListener("input", () => { shown = PAGE_SIZE; renderList(); });
$("#filter-type").addEventListener("change", () => { shown = PAGE_SIZE; renderList(); });
$("#sort").addEventListener("change", renderList);

$("#copy-btn").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(filteredKeywords().map((k) => k.keyword).join("\n"));
    toast("Keywords copy ho gaye");
  } catch {
    toast("Copy nahi ho saka");
  }
});

$("#csv-btn").addEventListener("click", () => {
  const rows = [["keyword", "popularity", "competition", "difficulty", "opportunity", "intent", "words", "sources"]];
  filteredKeywords().forEach((k) => rows.push([k.keyword, k.popularity, k.competition, k.difficulty, k.opportunity, k.intent, k.words, k.sources.join("|")]));
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" }));
  a.download = `${current.seed.replace(/\W+/g, "-")}-keywords.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

// ------------------------------------------------------------ history (chrome.storage.local)

async function saveHistory(data) {
  const { history = [] } = await chrome.storage.local.get("history");
  const item = { id: Date.now(), data };
  const next = [item, ...history.filter((h) => !(h.data.seed === data.seed && h.data.country === data.country && h.data.depth === data.depth))];
  try {
    await chrome.storage.local.set({ history: next.slice(0, HISTORY_MAX) });
  } catch {
    // Storage bhar gayi to purani entries kam karke dobara.
    await chrome.storage.local.set({ history: next.slice(0, 10) });
  }
}

async function loadHistory() {
  const { history = [] } = await chrome.storage.local.get("history");
  $("#history-list").innerHTML = history.map((h) => `
    <div class="h-item">
      <div class="grow" data-open="${h.id}"><b>${esc(h.data.seed)}</b>
        <small>${h.data.summary.total} keywords · ${h.data.country.toUpperCase()} · ${h.data.depth} · ${new Date(h.id).toLocaleString()}</small></div>
      <span class="pill" style="color:${colorFor(h.data.summary.niche_score)}">${h.data.summary.niche_score}</span>
      <button class="btn small" data-del="${h.id}" type="button">✕</button>
    </div>`).join("") || '<p class="muted">Abhi koi search nahi ki.</p>';
}

$("#history-list").addEventListener("click", async (e) => {
  const open = e.target.closest("[data-open]");
  const del = e.target.closest("[data-del]");
  const { history = [] } = await chrome.storage.local.get("history");
  if (open) {
    const item = history.find((h) => String(h.id) === open.dataset.open);
    if (item) {
      go("research");
      $("#kw").value = item.data.seed;
      $("#error").textContent = "";
      renderResults(item.data);
    }
  }
  if (del) {
    await chrome.storage.local.set({ history: history.filter((h) => String(h.id) !== del.dataset.del) });
    loadHistory();
  }
});

$("#clear-history").addEventListener("click", async () => {
  if (!confirm("Saari history delete karein?")) return;
  await chrome.storage.local.set({ history: [] });
  loadHistory();
});

// ------------------------------------------------------------ settings

$("#save-url").addEventListener("click", async () => {
  const url = $("#site-url").value.trim().replace(/\/+$/, "") || DEFAULT_SITE;
  if (!/^https?:\/\//.test(url)) return toast("URL http:// ya https:// se shuru ho");
  await chrome.storage.local.set({ siteUrl: url });
  $("#site-url").value = url;
  toast("Save ho gaya");
});

$("#open-site").addEventListener("click", async () => {
  const { siteUrl = DEFAULT_SITE } = await chrome.storage.local.get("siteUrl");
  chrome.tabs.create({ url: siteUrl });
});

// ------------------------------------------------------------ boot + right-click keyword

async function consumePending() {
  const { pendingKeyword } = await chrome.storage.session.get("pendingKeyword");
  if (!pendingKeyword) return;
  await chrome.storage.session.remove(["pendingKeyword", "pendingAt"]);
  runResearch(pendingKeyword);
}

chrome.storage.session.onChanged.addListener((changes) => {
  if (changes.pendingKeyword?.newValue) consumePending();
});

(async () => {
  const { prefs, siteUrl = DEFAULT_SITE } = await chrome.storage.local.get(["prefs", "siteUrl"]);
  if (prefs) {
    $("#country").value = prefs.gl;
    $("#language").value = prefs.hl;
    $("#depth").value = prefs.depth;
  }
  $("#site-url").value = siteUrl;
  consumePending();
})();
