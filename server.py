"""
SEO Niche Research Tool - local server.
Sirf Python standard library use hoti hai (koi pip install nahi chahiye).

Run:  python server.py
Open: http://localhost:8765
"""
import hashlib
import hmac
import json
import math
import os
import re
import secrets
import socket
import sqlite3
import string
import sys
import threading
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HOST = os.environ.get("SEO_HOST", "0.0.0.0")
PORT = int(os.environ.get("SEO_PORT", "8765"))
BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
DB_PATH = BASE_DIR / "data" / "seo_tool.db"

DEFAULT_ADMIN_USER = "admin"
DEFAULT_ADMIN_PASS = "Admin@12345"

SESSION_DAYS = 7
CACHE_HOURS = 6
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"

db_lock = threading.Lock()


# ---------------------------------------------------------------- database

def db():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def hash_password(password, salt=None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 200_000).hex()
    return f"{salt}${digest}"


def verify_password(password, stored):
    salt, _, digest = stored.partition("$")
    return hmac.compare_digest(hash_password(password, salt).partition("$")[2], digest)


def init_db():
    DB_PATH.parent.mkdir(exist_ok=True)
    with db_lock, db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'user',
                active INTEGER NOT NULL DEFAULT 1,
                created_at INTEGER NOT NULL,
                last_login INTEGER
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                expires_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS searches (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                keyword TEXT NOT NULL,
                country TEXT, language TEXT, depth TEXT,
                total INTEGER, niche_score INTEGER,
                result TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS cache (
                key TEXT PRIMARY KEY,
                result TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );
            """
        )
        if not conn.execute("SELECT 1 FROM users WHERE role='admin'").fetchone():
            conn.execute(
                "INSERT INTO users (username, password, role, created_at) VALUES (?,?,?,?)",
                (DEFAULT_ADMIN_USER, hash_password(DEFAULT_ADMIN_PASS), "admin", int(time.time())),
            )
        conn.execute("DELETE FROM sessions WHERE expires_at < ?", (int(time.time()),))


# ---------------------------------------------------------------- keyword research

QUESTION_WORDS = ("how", "what", "why", "when", "where", "which", "who", "is", "can", "does", "are", "should", "will", "do")
TRANSACTIONAL = ("buy", "price", "cheap", "discount", "coupon", "deal", "order", "for sale", "shop", "cost", "online", "delivery", "rate", "subscription")
COMMERCIAL = ("best", "top", "review", "reviews", "vs", "versus", "compare", "comparison", "alternative", "alternatives", "brand", "brands", "rated")
NAVIGATIONAL = ("login", "sign in", "website", "official", "app", "download", "contact", "near me", "address", "customer care")
INFORMATIONAL = ("how", "what", "why", "guide", "tutorial", "meaning", "ideas", "tips", "examples", "benefits", "side effects", "definition", "in urdu", "in hindi", "pdf", "course")

SOURCE_WEIGHT = {"google": 1.0, "youtube": 0.7, "duckduckgo": 0.6}


def http_json(url, timeout=6):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json,*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8", errors="replace"))


def fetch_suggestions(source, query, gl, hl):
    q = urllib.parse.quote(query)
    try:
        if source == "google":
            data = http_json(f"https://suggestqueries.google.com/complete/search?client=firefox&ie=utf-8&oe=utf-8&hl={hl}&gl={gl}&q={q}")
            return [s for s in data[1] if isinstance(s, str)]
        if source == "youtube":
            data = http_json(f"https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&ie=utf-8&oe=utf-8&hl={hl}&gl={gl}&q={q}")
            return [s for s in data[1] if isinstance(s, str)]
        if source == "duckduckgo":
            data = http_json(f"https://duckduckgo.com/ac/?q={q}&type=list&kl={gl}-{hl}")
            return [s for s in data[1] if isinstance(s, str)]
    except Exception:
        return []
    return []


def classify_intent(kw):
    text = f" {kw} "
    def has(words):
        return any(f" {w} " in text for w in words)
    if has(TRANSACTIONAL):
        return "transactional"
    if has(COMMERCIAL):
        return "commercial"
    if has(NAVIGATIONAL):
        return "navigational"
    return "informational"


def estimate_competition(kw, popularity):
    words = len(kw.split())
    score = 78 - (words - 2) * 11
    text = f" {kw} "
    if any(f" {w} " in text for w in COMMERCIAL + TRANSACTIONAL):
        score += 14
    if kw.split()[0] in QUESTION_WORDS:
        score -= 12
    if re.search(r"\b20\d\d\b", kw):
        score -= 6
    score += popularity * 0.15
    return int(max(5, min(95, round(score))))


def build_queries(seed, depth):
    queries = [seed]
    letters = list(string.ascii_lowercase)
    queries += [f"{seed} {c}" for c in letters]
    if depth == "deep":
        queries += [f"{w} {seed}" for w in ("how", "what", "why", "best", "is", "can", "where", "which", "top", "cheap")]
        queries += [f"{seed} {w}" for w in ("for", "vs", "with", "without", "near", "in", "to", "and", "like", "price", "ideas", "tips")]
        queries += [f"{c} {seed}" for c in letters[:10]]
    return queries


def research(seed, gl="us", hl="en", depth="quick"):
    seed = re.sub(r"\s+", " ", seed.strip().lower())
    sources = ["google", "duckduckgo"] + (["youtube"] if depth == "deep" else [])
    queries = build_queries(seed, depth)
    jobs = [(src, q) for q in queries for src in sources]

    started = time.time()
    with ThreadPoolExecutor(max_workers=16) as pool:
        results = list(pool.map(lambda j: (j[0], fetch_suggestions(j[0], j[1], gl, hl)), jobs))

    stats = {}
    failed = 0
    for src, sugg in results:
        if not sugg:
            failed += 1
        for pos, raw in enumerate(sugg[:10]):
            kw = re.sub(r"\s+", " ", raw.strip().lower())
            if not kw or len(kw) > 120:
                continue
            item = stats.setdefault(kw, {"weight": 0.0, "hits": 0, "sources": set(), "best_pos": 99})
            item["weight"] += (1 + (10 - pos) / 10) * SOURCE_WEIGHT[src]
            item["hits"] += 1
            item["sources"].add(src)
            item["best_pos"] = min(item["best_pos"], pos + 1)

    keywords = []
    for kw, s in stats.items():
        popularity = int(round(100 * (1 - math.exp(-s["weight"] / 3))))
        competition = estimate_competition(kw, popularity)
        opportunity = int(round(math.sqrt(popularity * (100 - competition))))
        keywords.append({
            "keyword": kw,
            "words": len(kw.split()),
            "popularity": popularity,
            "competition": competition,
            "difficulty": "Easy" if competition < 40 else "Medium" if competition < 65 else "Hard",
            "opportunity": opportunity,
            "intent": classify_intent(kw),
            "sources": sorted(s["sources"]),
            "is_question": kw.split()[0] in QUESTION_WORDS,
            "long_tail": len(kw.split()) >= 4,
        })
    keywords.sort(key=lambda k: (-k["opportunity"], -k["popularity"]))

    seed_words = set(seed.split())
    stop = {"the", "a", "an", "of", "for", "in", "to", "and", "or", "with", "on", "is", "my", "me", "at", "by", "vs"}
    mod_count = {}
    for k in keywords:
        for w in k["keyword"].split():
            if w not in seed_words and w not in stop and len(w) > 1:
                mod_count[w] = mod_count.get(w, 0) + 1
    modifiers = sorted(mod_count.items(), key=lambda x: -x[1])[:30]

    intents = {i: 0 for i in ("informational", "commercial", "transactional", "navigational")}
    for k in keywords:
        intents[k["intent"]] += 1

    top = keywords[:20]
    avg_opp = sum(k["opportunity"] for k in top) / len(top) if top else 0
    breadth = min(1.0, len(keywords) / 150)
    commercial_share = (intents["commercial"] + intents["transactional"]) / max(1, len(keywords))
    niche_score = int(round(avg_opp * 0.7 + breadth * 20 + commercial_share * 10 * 1.0))
    niche_score = max(0, min(100, niche_score))
    verdict = "Excellent" if niche_score >= 70 else "Good" if niche_score >= 55 else "Average" if niche_score >= 40 else "Tough"

    return {
        "seed": seed,
        "country": gl,
        "language": hl,
        "depth": depth,
        "generated_at": int(time.time()),
        "duration": round(time.time() - started, 1),
        "requests": len(jobs),
        "failed_requests": failed,
        "summary": {
            "total": len(keywords),
            "questions": sum(1 for k in keywords if k["is_question"]),
            "long_tail": sum(1 for k in keywords if k["long_tail"]),
            "easy": sum(1 for k in keywords if k["difficulty"] == "Easy"),
            "avg_competition": int(round(sum(k["competition"] for k in keywords) / max(1, len(keywords)))),
            "niche_score": niche_score,
            "verdict": verdict,
            "intents": intents,
        },
        "modifiers": modifiers,
        "keywords": keywords,
    }


def cached_research(seed, gl, hl, depth):
    key = f"{seed.strip().lower()}|{gl}|{hl}|{depth}"
    with db_lock, db() as conn:
        row = conn.execute("SELECT result, created_at FROM cache WHERE key=?", (key,)).fetchone()
    if row and time.time() - row["created_at"] < CACHE_HOURS * 3600:
        result = json.loads(row["result"])
        result["cached"] = True
        return result
    result = research(seed, gl, hl, depth)
    if result["keywords"]:
        with db_lock, db() as conn:
            conn.execute("INSERT OR REPLACE INTO cache (key, result, created_at) VALUES (?,?,?)",
                         (key, json.dumps(result), int(time.time())))
    result["cached"] = False
    return result


# ---------------------------------------------------------------- http

MIME = {".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json",
        ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon"}

login_failures = {}


class Handler(BaseHTTPRequestHandler):
    server_version = "SEONicheTool/1.0"

    def log_message(self, fmt, *args):
        sys.stdout.write("[%s] %s\n" % (time.strftime("%H:%M:%S"), fmt % args))

    # ---- helpers
    def send_json(self, data, status=200, headers=None):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > 1_000_000:
            return {}
        try:
            return json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            return {}

    def current_user(self):
        cookie = SimpleCookie(self.headers.get("Cookie", ""))
        token = cookie["sid"].value if "sid" in cookie else None
        if not token:
            return None
        with db_lock, db() as conn:
            row = conn.execute(
                "SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at>? AND u.active=1",
                (token, int(time.time())),
            ).fetchone()
        return dict(row) if row else None

    def require(self, admin=False):
        user = self.current_user()
        if not user:
            self.send_json({"error": "Login required"}, 401)
            return None
        if admin and user["role"] != "admin":
            self.send_json({"error": "Admin only"}, 403)
            return None
        return user

    def serve_static(self, path):
        if path in ("/", ""):
            path = "/index.html"
        target = (STATIC_DIR / path.lstrip("/")).resolve()
        if not str(target).startswith(str(STATIC_DIR)) or not target.is_file():
            target = STATIC_DIR / "index.html"
        data = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", MIME.get(target.suffix, "application/octet-stream"))
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        if target.name == "sw.js":
            self.send_header("Service-Worker-Allowed", "/")
        self.end_headers()
        self.wfile.write(data)

    # ---- routing
    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if not path.startswith("/api/"):
            return self.serve_static(path)

        if path == "/api/me":
            user = self.current_user()
            if not user:
                return self.send_json({"user": None})
            return self.send_json({"user": {"id": user["id"], "username": user["username"], "role": user["role"]}})

        if path == "/api/history":
            user = self.require()
            if not user:
                return
            with db_lock, db() as conn:
                rows = conn.execute(
                    "SELECT id, keyword, country, language, depth, total, niche_score, created_at FROM searches WHERE user_id=? ORDER BY id DESC LIMIT 200",
                    (user["id"],),
                ).fetchall()
            return self.send_json({"items": [dict(r) for r in rows]})

        m = re.fullmatch(r"/api/history/(\d+)", path)
        if m:
            user = self.require()
            if not user:
                return
            with db_lock, db() as conn:
                row = conn.execute("SELECT * FROM searches WHERE id=?", (int(m.group(1)),)).fetchone()
            if not row or (row["user_id"] != user["id"] and user["role"] != "admin"):
                return self.send_json({"error": "Not found"}, 404)
            return self.send_json(json.loads(row["result"]))

        if path == "/api/admin/stats":
            if not self.require(admin=True):
                return
            day_ago = int(time.time()) - 86400
            with db_lock, db() as conn:
                stats = {
                    "users": conn.execute("SELECT COUNT(*) FROM users").fetchone()[0],
                    "active_users": conn.execute("SELECT COUNT(*) FROM users WHERE active=1").fetchone()[0],
                    "searches": conn.execute("SELECT COUNT(*) FROM searches").fetchone()[0],
                    "searches_24h": conn.execute("SELECT COUNT(*) FROM searches WHERE created_at>?", (day_ago,)).fetchone()[0],
                    "keywords_found": conn.execute("SELECT COALESCE(SUM(total),0) FROM searches").fetchone()[0],
                    "top_seeds": [dict(r) for r in conn.execute(
                        "SELECT keyword, COUNT(*) AS n FROM searches GROUP BY keyword ORDER BY n DESC LIMIT 8").fetchall()],
                }
            return self.send_json(stats)

        if path == "/api/admin/users":
            if not self.require(admin=True):
                return
            with db_lock, db() as conn:
                rows = conn.execute(
                    "SELECT u.id, u.username, u.role, u.active, u.created_at, u.last_login, "
                    "(SELECT COUNT(*) FROM searches s WHERE s.user_id=u.id) AS searches FROM users u ORDER BY u.id"
                ).fetchall()
            return self.send_json({"items": [dict(r) for r in rows]})

        if path == "/api/admin/searches":
            if not self.require(admin=True):
                return
            with db_lock, db() as conn:
                rows = conn.execute(
                    "SELECT s.id, s.keyword, s.country, s.language, s.depth, s.total, s.niche_score, s.created_at, u.username "
                    "FROM searches s JOIN users u ON u.id=s.user_id ORDER BY s.id DESC LIMIT 300"
                ).fetchall()
            return self.send_json({"items": [dict(r) for r in rows]})

        self.send_json({"error": "Not found"}, 404)

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        body = self.read_json()

        if path == "/api/login":
            ip = self.client_address[0]
            fails = [t for t in login_failures.get(ip, []) if time.time() - t < 600]
            if len(fails) >= 8:
                return self.send_json({"error": "Bohat zyada ghalat koshishen. 10 minute baad try karein."}, 429)
            username = str(body.get("username", "")).strip().lower()
            password = str(body.get("password", ""))
            with db_lock, db() as conn:
                row = conn.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
            if not row or not verify_password(password, row["password"]):
                login_failures[ip] = fails + [time.time()]
                return self.send_json({"error": "Ghalat username ya password"}, 401)
            if not row["active"]:
                return self.send_json({"error": "Yeh account band hai. Admin se rabta karein."}, 403)
            login_failures.pop(ip, None)
            token = secrets.token_urlsafe(32)
            with db_lock, db() as conn:
                conn.execute("INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)",
                             (token, row["id"], int(time.time()) + SESSION_DAYS * 86400))
                conn.execute("UPDATE users SET last_login=? WHERE id=?", (int(time.time()), row["id"]))
            cookie = f"sid={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={SESSION_DAYS * 86400}"
            return self.send_json({"user": {"id": row["id"], "username": row["username"], "role": row["role"]}},
                                  headers={"Set-Cookie": cookie})

        if path == "/api/logout":
            cookie = SimpleCookie(self.headers.get("Cookie", ""))
            if "sid" in cookie:
                with db_lock, db() as conn:
                    conn.execute("DELETE FROM sessions WHERE token=?", (cookie["sid"].value,))
            return self.send_json({"ok": True}, headers={"Set-Cookie": "sid=; Path=/; Max-Age=0"})

        if path == "/api/research":
            user = self.require()
            if not user:
                return
            keyword = str(body.get("keyword", "")).strip()
            if not keyword or len(keyword) > 80:
                return self.send_json({"error": "Keyword likhein (80 characters tak)"}, 400)
            gl = re.sub(r"[^a-z]", "", str(body.get("country", "us")).lower())[:2] or "us"
            hl = re.sub(r"[^a-z]", "", str(body.get("language", "en")).lower())[:2] or "en"
            depth = "deep" if body.get("depth") == "deep" else "quick"
            result = cached_research(keyword, gl, hl, depth)
            if not result["keywords"]:
                return self.send_json({"error": "Koi keyword nahi mila. Internet connection check karein ya doosra keyword try karein."}, 502)
            with db_lock, db() as conn:
                cur = conn.execute(
                    "INSERT INTO searches (user_id, keyword, country, language, depth, total, niche_score, result, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
                    (user["id"], result["seed"], gl, hl, depth, result["summary"]["total"],
                     result["summary"]["niche_score"], json.dumps(result), int(time.time())),
                )
                result["search_id"] = cur.lastrowid
            return self.send_json(result)

        if path == "/api/change-password":
            user = self.require()
            if not user:
                return
            old, new = str(body.get("old", "")), str(body.get("new", ""))
            if not verify_password(old, user["password"]):
                return self.send_json({"error": "Purana password ghalat hai"}, 400)
            if len(new) < 6:
                return self.send_json({"error": "Naya password kam az kam 6 characters ka ho"}, 400)
            with db_lock, db() as conn:
                conn.execute("UPDATE users SET password=? WHERE id=?", (hash_password(new), user["id"]))
            return self.send_json({"ok": True})

        if path == "/api/admin/users":
            if not self.require(admin=True):
                return
            username = str(body.get("username", "")).strip().lower()
            password = str(body.get("password", ""))
            role = "admin" if body.get("role") == "admin" else "user"
            if not re.fullmatch(r"[a-z0-9_.-]{3,32}", username):
                return self.send_json({"error": "Username 3-32 characters (a-z, 0-9, _ . -)"}, 400)
            if len(password) < 6:
                return self.send_json({"error": "Password kam az kam 6 characters ka ho"}, 400)
            try:
                with db_lock, db() as conn:
                    conn.execute("INSERT INTO users (username, password, role, created_at) VALUES (?,?,?,?)",
                                 (username, hash_password(password), role, int(time.time())))
            except sqlite3.IntegrityError:
                return self.send_json({"error": "Yeh username pehle se mojood hai"}, 400)
            return self.send_json({"ok": True})

        m = re.fullmatch(r"/api/admin/users/(\d+)/(password|toggle)", path)
        if m:
            admin = self.require(admin=True)
            if not admin:
                return
            uid, action = int(m.group(1)), m.group(2)
            with db_lock, db() as conn:
                if action == "password":
                    new = str(body.get("password", ""))
                    if len(new) < 6:
                        return self.send_json({"error": "Password kam az kam 6 characters ka ho"}, 400)
                    conn.execute("UPDATE users SET password=? WHERE id=?", (hash_password(new), uid))
                    conn.execute("DELETE FROM sessions WHERE user_id=?", (uid,))
                else:
                    if uid == admin["id"]:
                        return self.send_json({"error": "Apna account band nahi kar sakte"}, 400)
                    conn.execute("UPDATE users SET active = 1 - active WHERE id=?", (uid,))
                    conn.execute("DELETE FROM sessions WHERE user_id=?", (uid,))
            return self.send_json({"ok": True})

        self.send_json({"error": "Not found"}, 404)

    def do_DELETE(self):
        path = urllib.parse.urlparse(self.path).path

        m = re.fullmatch(r"/api/history/(\d+)", path)
        if m:
            user = self.require()
            if not user:
                return
            with db_lock, db() as conn:
                if user["role"] == "admin":
                    conn.execute("DELETE FROM searches WHERE id=?", (int(m.group(1)),))
                else:
                    conn.execute("DELETE FROM searches WHERE id=? AND user_id=?", (int(m.group(1)), user["id"]))
            return self.send_json({"ok": True})

        m = re.fullmatch(r"/api/admin/users/(\d+)", path)
        if m:
            admin = self.require(admin=True)
            if not admin:
                return
            uid = int(m.group(1))
            if uid == admin["id"]:
                return self.send_json({"error": "Apna account delete nahi kar sakte"}, 400)
            with db_lock, db() as conn:
                conn.execute("DELETE FROM sessions WHERE user_id=?", (uid,))
                conn.execute("DELETE FROM searches WHERE user_id=?", (uid,))
                conn.execute("DELETE FROM users WHERE id=?", (uid,))
            return self.send_json({"ok": True})

        self.send_json({"error": "Not found"}, 404)


def lan_ip():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"


def main():
    init_db()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print("=" * 60)
    print("  SEO Niche Research Tool chal raha hai")
    print(f"  Computer par:  http://localhost:{PORT}")
    print(f"  Mobile par (same WiFi):  http://{lan_ip()}:{PORT}")
    print(f"  Default admin: {DEFAULT_ADMIN_USER} / {DEFAULT_ADMIN_PASS}")
    print("  Band karne ke liye: Ctrl + C")
    print("=" * 60)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer band ho gaya.")


if __name__ == "__main__":
    main()
