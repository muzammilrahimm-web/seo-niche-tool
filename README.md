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
