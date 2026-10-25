const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDate = (t) => (t ? new Date(t * 1000).toLocaleString() : "–");

let me = null;
let current = null;
let sort = { key: "opportunity", asc: false };
let installPrompt = null;

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || (opts.body ? "POST" : "GET"),
    headers: opts.body ? { "Content-Type": "application/json" } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== "/api/login") showLogin();
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("show"), 2200);
}

const colorFor = (v, invert) => {
  const good = invert ? v < 40 : v >= 60;
  const mid = invert ? v < 65 : v >= 40;
  return good ? "var(--accent)" : mid ? "var(--warn)" : "var(--bad)";
};

// ------------------------------------------------------------ auth

function showLogin() {
  me = null;
  $("#app").classList.add("hidden");
  $("#login-view").classList.remove("hidden");
}

function showApp() {
  $("#login-view").classList.add("hidden");
  $("#app").classList.remove("hidden");
  $("#who-name").textContent = me.username;
  $("#who-role").textContent = me.role;
  $$(".admin-only").forEach((el) => el.classList.toggle("hidden", me.role !== "admin"));
  go("research");
}

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  $("#login-error").textContent = "";
  try {
    const { user } = await api("/api/login", { body: { username: f.get("username"), password: f.get("password") } });
    me = user;
    e.target.reset();
    showApp();
  } catch (err) {
    $("#login-error").textContent = err.message;
  }
});

async function logout() {
  await api("/api/logout", { body: {} }).catch(() => {});
  showLogin();
}
$("#logout-btn").addEventListener("click", logout);
$("#logout-btn-2").addEventListener("click", logout);

// ------------------------------------------------------------ navigation

function go(view) {
  $$("#nav a").forEach((a) => a.classList.toggle("active", a.dataset.view === view));
  $$(".view").forEach((v) => v.classList.toggle("hidden", v.id !== `view-${view}`));
  if (view === "history") loadHistory();
  if (view === "admin") loadAdmin();
  window.scrollTo(0, 0);
}
$$("#nav a").forEach((a) => a.addEventListener("click", () => go(a.dataset.view)));

// ------------------------------------------------------------ research

$("#research-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  runResearch($("#kw").value);
});

async function runResearch(keyword) {
  $("#kw").value = keyword;
  $("#research-error").textContent = "";
  $("#results").classList.add("hidden");
  $("#loading").classList.remove("hidden");
  $("#research-btn").disabled = true;
  go("research");
  try {
    const data = await api("/api/research", {
      body: { keyword, country: $("#country").value, language: $("#language").value, depth: $("#depth").value },
    });
    renderResults(data);
  } catch (err) {
    $("#research-error").textContent = err.message;
  } finally {
    $("#loading").classList.add("hidden");
    $("#research-btn").disabled = false;
  }
}

function renderResults(data) {
  current = data;
  const s = data.summary;
  $("#results").classList.remove("hidden");

  const ring = $("#score-ring");
  ring.style.setProperty("--p", s.niche_score);
  ring.style.setProperty("--c", colorFor(s.niche_score));
  $("#niche-score").textContent = s.niche_score;
  $("#verdict").textContent = `${s.verdict} niche`;
  $("#meta").textContent = `"${data.seed}" · ${data.country.toUpperCase()} · ${data.depth}${data.cached ? " · cached" : ` · ${data.duration}s`}`;

  $("#stats").innerHTML = [
    ["Keywords", s.total],
    ["Easy", s.easy],
    ["Questions", s.questions],
    ["Long-tail", s.long_tail],
    ["Avg. Competition", s.avg_competition],
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
  renderTable();
}

$("#modifiers").addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (chip) runResearch(chip.dataset.kw);
});

function filteredKeywords() {
  if (!current) return [];
  const text = $("#filter-text").value.trim().toLowerCase();
  const type = $("#filter-type").value;
  let list = current.keywords.filter((k) => {
    if (text && !k.keyword.includes(text)) return false;
    if (type === "easy") return k.difficulty === "Easy";
    if (type === "questions") return k.is_question;
    if (type === "longtail") return k.long_tail;
    if (type === "commercial") return k.intent === "commercial" || k.intent === "transactional";
    return true;
  });
  const { key, asc } = sort;
  list.sort((a, b) => {
    const r = typeof a[key] === "number" ? a[key] - b[key] : String(a[key]).localeCompare(String(b[key]));
    return asc ? r : -r;
  });
  return list;
}

const meter = (v, invert) =>
  `<div class="meter"><div class="bar"><i style="width:${v}%;background:${colorFor(v, invert)}"></i></div>${v}</div>`;

function renderTable() {
  const list = filteredKeywords();
  $("#kw-count").textContent = `(${list.length})`;
  $$("#kw-table th").forEach((th) => {
    th.classList.toggle("sorted", th.dataset.sort === sort.key);
    th.classList.toggle("asc", th.dataset.sort === sort.key && sort.asc);
  });
  $("#kw-table tbody").innerHTML = list.map((k) => `
    <tr>
      <td class="kw"><a href="https://www.google.com/search?q=${encodeURIComponent(k.keyword)}" target="_blank" rel="noopener">${esc(k.keyword)}</a></td>
      <td>${meter(k.popularity)}</td>
      <td>${meter(k.competition, true)}</td>
      <td><b style="color:${colorFor(k.opportunity)}">${k.opportunity}</b></td>
      <td><span class="tag ${k.intent}">${k.intent}</span></td>
      <td>${k.words}</td>
    </tr>`).join("") || '<tr><td colspan="6" class="muted">Koi keyword match nahi hua</td></tr>';
}

$("#filter-text").addEventListener("input", renderTable);
$("#filter-type").addEventListener("change", renderTable);
$$("#kw-table th[data-sort]").forEach((th) => th.addEventListener("click", () => {
  const key = th.dataset.sort;
  sort = { key, asc: sort.key === key ? !sort.asc : key === "keyword" || key === "competition" };
  renderTable();
}));

$("#copy-btn").addEventListener("click", async () => {
  const text = filteredKeywords().map((k) => k.keyword).join("\n");
  try {
    await navigator.clipboard.writeText(text);
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
  URL.revokeObjectURL(a.href);
});

// ------------------------------------------------------------ history

async function loadHistory() {
  const box = $("#history-list");
  box.innerHTML = '<p class="muted">Loading…</p>';
  try {
    const { items } = await api("/api/history");
    box.innerHTML = items.map((h) => `
      <div class="list-item">
        <div class="grow" data-open="${h.id}"><b>${esc(h.keyword)}</b><small>${h.total} keywords · ${h.country.toUpperCase()} · ${h.depth} · ${fmtDate(h.created_at)}</small></div>
        <span class="pill" style="color:${colorFor(h.niche_score)}">${h.niche_score}</span>
        <button class="btn small danger" data-del="${h.id}">✕</button>
      </div>`).join("") || '<p class="muted">Abhi koi search nahi ki.</p>';
  } catch (err) {
    box.innerHTML = `<p class="error">${esc(err.message)}</p>`;
  }
}

$("#history-list").addEventListener("click", async (e) => {
  const open = e.target.closest("[data-open]");
  const del = e.target.closest("[data-del]");
  if (open) openSearch(open.dataset.open);
  if (del && confirm("Yeh search delete karein?")) {
    await api(`/api/history/${del.dataset.del}`, { method: "DELETE" });
    loadHistory();
  }
});

async function openSearch(id) {
  try {
    const data = await api(`/api/history/${id}`);
    go("research");
    $("#kw").value = data.seed;
    $("#research-error").textContent = "";
    renderResults(data);
  } catch (err) {
    toast(err.message);
  }
}

// ------------------------------------------------------------ admin

async function loadAdmin() {
  try {
    const [stats, users, searches] = await Promise.all([
      api("/api/admin/stats"), api("/api/admin/users"), api("/api/admin/searches"),
    ]);
    $("#admin-stats").innerHTML = [
      ["Total Users", stats.users], ["Active Users", stats.active_users], ["Total Searches", stats.searches],
      ["Searches (24h)", stats.searches_24h], ["Keywords Found", stats.keywords_found],
    ].map(([l, v]) => `<div class="stat"><b>${v}</b><small>${l}</small></div>`).join("");

    $("#top-seeds").innerHTML = stats.top_seeds.map((t) =>
      `<div class="list-item"><div class="grow"><b>${esc(t.keyword)}</b></div><span class="pill">${t.n}</span></div>`).join("") ||
      '<p class="muted">Abhi koi data nahi.</p>';

    $("#users-table tbody").innerHTML = users.items.map((u) => `
      <tr>
        <td><b>${esc(u.username)}</b></td>
        <td>${u.role}</td>
        <td><span class="tag ${u.active ? "on" : "off"}">${u.active ? "Active" : "Blocked"}</span></td>
        <td>${u.searches}</td>
        <td>${fmtDate(u.last_login)}</td>
        <td>
          <button class="btn small" data-pw="${u.id}" data-name="${esc(u.username)}">Reset password</button>
          ${u.id === me.id ? "" : `
          <button class="btn small" data-toggle="${u.id}">${u.active ? "Block" : "Unblock"}</button>
          <button class="btn small danger" data-deluser="${u.id}" data-name="${esc(u.username)}">Delete</button>`}
        </td>
      </tr>`).join("");

    $("#searches-table tbody").innerHTML = searches.items.map((s) => `
      <tr>
        <td><a href="#" data-open="${s.id}">${esc(s.keyword)}</a></td><td>${esc(s.username)}</td>
        <td>${s.country.toUpperCase()}</td><td>${s.total}</td>
        <td><b style="color:${colorFor(s.niche_score)}">${s.niche_score}</b></td><td>${fmtDate(s.created_at)}</td>
      </tr>`).join("") || '<tr><td colspan="6" class="muted">Abhi koi search nahi.</td></tr>';
  } catch (err) {
    toast(err.message);
  }
}

$("#searches-table").addEventListener("click", (e) => {
  const a = e.target.closest("[data-open]");
  if (a) { e.preventDefault(); openSearch(a.dataset.open); }
});

$("#users-table").addEventListener("click", async (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  try {
    if (b.dataset.pw) {
      const pw = prompt(`"${b.dataset.name}" ka naya password (6+ chars):`);
      if (!pw) return;
      await api(`/api/admin/users/${b.dataset.pw}/password`, { body: { password: pw } });
      toast("Password badal gaya");
    } else if (b.dataset.toggle) {
      await api(`/api/admin/users/${b.dataset.toggle}/toggle`, { body: {} });
    } else if (b.dataset.deluser) {
      if (!confirm(`"${b.dataset.name}" aur us ki saari searches delete karein?`)) return;
      await api(`/api/admin/users/${b.dataset.deluser}`, { method: "DELETE" });
      toast("User delete ho gaya");
    }
    loadAdmin();
  } catch (err) {
    toast(err.message);
  }
});

$("#new-user-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  $("#new-user-error").textContent = "";
  try {
    await api("/api/admin/users", { body: Object.fromEntries(f) });
    e.target.reset();
    toast("User ban gaya");
    loadAdmin();
  } catch (err) {
    $("#new-user-error").textContent = err.message;
  }
});

// ------------------------------------------------------------ settings

$("#pw-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const msg = $("#pw-msg");
  try {
    await api("/api/change-password", { body: { old: f.get("old"), new: f.get("new") } });
    msg.className = "muted";
    msg.textContent = "Password badal gaya ✓";
    e.target.reset();
  } catch (err) {
    msg.className = "error";
    msg.textContent = err.message;
  }
});

// ------------------------------------------------------------ PWA install

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e;
  $$(".install-btn").forEach((b) => b.classList.remove("hidden"));
});
$$(".install-btn").forEach((b) => b.addEventListener("click", async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  $$(".install-btn").forEach((x) => x.classList.add("hidden"));
}));

// ------------------------------------------------------------ boot

api("/api/me").then(({ user }) => {
  if (user) { me = user; showApp(); } else showLogin();
}).catch(showLogin);
