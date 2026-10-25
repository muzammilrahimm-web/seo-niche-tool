# Niche Finder — SEO Niche Research Tool

Yeh ek local SEO niche/keyword research tool hai jo Windows par aur Android mobile par app ki tarah chalta hai (PWA).

## Kaise chalayein
1. `START.bat` par double-click karein (ya terminal mein `python server.py` chalayein).
2. Browser khud khul jayega: http://localhost:8765
3. Login karein:
   - **Admin ID:** `admin`
   - **Password:** `Admin@12345`  (login ke baad Settings mein zaroor badlein)

Koi `pip install` nahi chahiye — sirf Python 3.

## App install
- **Windows:** Chrome/Edge mein http://localhost:8765 kholein → address bar mein install icon ya sidebar ka "Install App" button.
- **Android:** Computer aur mobile ek hi WiFi par hon. Server start hone par terminal mein `http://192.168.x.x:8765` wala address dikhega, mobile Chrome mein kholein → menu (⋮) → "Add to Home screen".
  Pehli dafa Windows Firewall poochay to "Allow" karein.

## Features
- Seed keyword se Google, DuckDuckGo aur (Deep mode mein) YouTube autocomplete se sainkron keywords
- Har keyword ka Popularity, Competition, Opportunity score (0–100) aur search intent
- Niche Score + verdict (Excellent / Good / Average / Tough)
- Filters: Easy, Questions, Long-tail, Commercial — CSV export aur Copy
- Top modifiers (content ideas) — click karke us par naya research
- **Sign-up:** log login page par "Sign up karein" dabakar khud account bana sakte hain
- Search history (har user ki alag)
- Admin panel: sign-up on/off switch, users banayein, block/unblock, password reset, delete, saari searches aur stats

## Note
Scores free autocomplete data se banay hue estimates hain, asal Google search volume nahi. Asal volume ke liye paid API (Google Ads / DataForSEO) chahiye.

Data `data/seo_tool.db` mein save hota hai. Admin password bhool jayein to yeh file delete karke server dobara chalayein (saara data reset ho jayega, default admin wapas aa jayega).

## Online publish (Render — free)
1. Is link par jaayein: https://render.com/deploy?repo=https://github.com/muzammilrahimm-web/seo-niche-tool
2. GitHub se Render par login karein.
3. `ADMIN_PASSWORD` mein apna mazboot admin password likhein (`GOOGLE_SITE_VERIFICATION` abhi khaali chhod sakte hain).
4. "Deploy" dabayein. Kuch minute baad URL milega: `https://seo-niche-tool.onrender.com` (ya milta julta).

Free plan par 15 minute koi na aaye to server so jata hai, pehli dafa khulne mein ~1 minute lagta hai.
Free plan par disk permanent nahi: restart/redeploy par users aur history mit sakti hai (admin password env se wapas set ho jata hai).

## Google par laana (Search Console)
1. https://search.google.com/search-console kholein → "Add property" → "URL prefix" → apna Render URL.
2. "HTML tag" method chunein, `content="..."` wala code copy karein.
3. Render → Environment → `GOOGLE_SITE_VERIFICATION` mein woh code dalein → Save (app restart hogi).
4. Search Console mein "Verify" dabayein.
5. Sitemaps mein `sitemap.xml` submit karein, aur URL Inspection mein "Request indexing" dabayein.
Google ko site dikhane mein aam tor par kuch din se 2-3 hafte lagte hain.
