// server.py ke research() ka JavaScript version — extension bina server ke chalta hai.

const QUESTION_WORDS = ["how", "what", "why", "when", "where", "which", "who", "is", "can", "does", "are", "should", "will", "do"];
const TRANSACTIONAL = ["buy", "price", "cheap", "discount", "coupon", "deal", "order", "for sale", "shop", "cost", "online", "delivery", "rate", "subscription"];
const COMMERCIAL = ["best", "top", "review", "reviews", "vs", "versus", "compare", "comparison", "alternative", "alternatives", "brand", "brands", "rated"];
const NAVIGATIONAL = ["login", "sign in", "website", "official", "app", "download", "contact", "near me", "address", "customer care"];
const SOURCE_WEIGHT = { google: 1.0, youtube: 0.7, duckduckgo: 0.6 };
const LETTERS = "abcdefghijklmnopqrstuvwxyz".split("");

const clean = (s) => s.trim().toLowerCase().replace(/\s+/g, " ");
const hasAny = (kw, words) => words.some((w) => ` ${kw} `.includes(` ${w} `));

async function fetchSuggestions(source, query, gl, hl) {
  const q = encodeURIComponent(query);
  const urls = {
    google: `https://suggestqueries.google.com/complete/search?client=firefox&ie=utf-8&oe=utf-8&hl=${hl}&gl=${gl}&q=${q}`,
    youtube: `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&ie=utf-8&oe=utf-8&hl=${hl}&gl=${gl}&q=${q}`,
    duckduckgo: `https://duckduckgo.com/ac/?q=${q}&type=list&kl=${gl}-${hl}`,
  };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(urls[source], { signal: ctrl.signal });
    clearTimeout(timer);
    const data = await res.json();
    return (data[1] || []).filter((s) => typeof s === "string");
  } catch {
    return [];
  }
}

function classifyIntent(kw) {
  if (hasAny(kw, TRANSACTIONAL)) return "transactional";
  if (hasAny(kw, COMMERCIAL)) return "commercial";
  if (hasAny(kw, NAVIGATIONAL)) return "navigational";
  return "informational";
}

function estimateCompetition(kw, popularity) {
  const words = kw.split(" ");
  let score = 78 - (words.length - 2) * 11;
  if (hasAny(kw, [...COMMERCIAL, ...TRANSACTIONAL])) score += 14;
  if (QUESTION_WORDS.includes(words[0])) score -= 12;
  if (/\b20\d\d\b/.test(kw)) score -= 6;
  score += popularity * 0.15;
  return Math.max(5, Math.min(95, Math.round(score)));
}

function buildQueries(seed, depth) {
  const queries = [seed, ...LETTERS.map((c) => `${seed} ${c}`)];
  if (depth === "deep") {
    queries.push(...["how", "what", "why", "best", "is", "can", "where", "which", "top", "cheap"].map((w) => `${w} ${seed}`));
    queries.push(...["for", "vs", "with", "without", "near", "in", "to", "and", "like", "price", "ideas", "tips"].map((w) => `${seed} ${w}`));
    queries.push(...LETTERS.slice(0, 10).map((c) => `${c} ${seed}`));
  }
  return queries;
}

async function runPool(jobs, limit, worker, onProgress) {
  const results = new Array(jobs.length);
  let next = 0;
  let done = 0;
  async function lane() {
    while (next < jobs.length) {
      const i = next++;
      results[i] = await worker(jobs[i]);
      onProgress?.(++done, jobs.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, lane));
  return results;
}

async function research(rawSeed, { gl = "us", hl = "en", depth = "quick" } = {}, onProgress) {
  const seed = clean(rawSeed);
  const sources = ["google", "duckduckgo", ...(depth === "deep" ? ["youtube"] : [])];
  const jobs = buildQueries(seed, depth).flatMap((q) => sources.map((src) => [src, q]));
  const started = Date.now();

  const results = await runPool(jobs, 12, async ([src, q]) => [src, await fetchSuggestions(src, q, gl, hl)], onProgress);

  const stats = new Map();
  let failed = 0;
  for (const [src, sugg] of results) {
    if (!sugg.length) failed++;
    sugg.slice(0, 10).forEach((raw, pos) => {
      const kw = clean(raw);
      if (!kw || kw.length > 120) return;
      const item = stats.get(kw) || { weight: 0, sources: new Set() };
      item.weight += (1 + (10 - pos) / 10) * SOURCE_WEIGHT[src];
      item.sources.add(src);
      stats.set(kw, item);
    });
  }

  const keywords = [...stats].map(([kw, s]) => {
    const popularity = Math.round(100 * (1 - Math.exp(-s.weight / 3)));
    const competition = estimateCompetition(kw, popularity);
    const words = kw.split(" ").length;
    return {
      keyword: kw,
      words,
      popularity,
      competition,
      difficulty: competition < 40 ? "Easy" : competition < 65 ? "Medium" : "Hard",
      opportunity: Math.round(Math.sqrt(popularity * (100 - competition))),
      intent: classifyIntent(kw),
      sources: [...s.sources].sort(),
      is_question: QUESTION_WORDS.includes(kw.split(" ")[0]),
      long_tail: words >= 4,
    };
  });
  keywords.sort((a, b) => b.opportunity - a.opportunity || b.popularity - a.popularity);

  const seedWords = new Set(seed.split(" "));
  const stop = new Set(["the", "a", "an", "of", "for", "in", "to", "and", "or", "with", "on", "is", "my", "me", "at", "by", "vs"]);
  const modCount = new Map();
  for (const k of keywords) {
    for (const w of k.keyword.split(" ")) {
      if (!seedWords.has(w) && !stop.has(w) && w.length > 1) modCount.set(w, (modCount.get(w) || 0) + 1);
    }
  }
  const modifiers = [...modCount].sort((a, b) => b[1] - a[1]).slice(0, 30);

  const intents = { informational: 0, commercial: 0, transactional: 0, navigational: 0 };
  keywords.forEach((k) => intents[k.intent]++);

  const top = keywords.slice(0, 20);
  const avgOpp = top.length ? top.reduce((a, k) => a + k.opportunity, 0) / top.length : 0;
  const breadth = Math.min(1, keywords.length / 150);
  const commercialShare = (intents.commercial + intents.transactional) / Math.max(1, keywords.length);
  const nicheScore = Math.max(0, Math.min(100, Math.round(avgOpp * 0.7 + breadth * 20 + commercialShare * 10)));
  const verdict = nicheScore >= 70 ? "Excellent" : nicheScore >= 55 ? "Good" : nicheScore >= 40 ? "Average" : "Tough";

  return {
    seed, country: gl, language: hl, depth,
    generated_at: Math.floor(Date.now() / 1000),
    duration: Math.round((Date.now() - started) / 100) / 10,
    requests: jobs.length,
    failed_requests: failed,
    summary: {
      total: keywords.length,
      questions: keywords.filter((k) => k.is_question).length,
      long_tail: keywords.filter((k) => k.long_tail).length,
      easy: keywords.filter((k) => k.difficulty === "Easy").length,
      avg_competition: Math.round(keywords.reduce((a, k) => a + k.competition, 0) / Math.max(1, keywords.length)),
      niche_score: nicheScore,
      verdict,
      intents,
    },
    modifiers,
    keywords,
  };
}
