# Superheated Vapor database

Steam analytics warehouse on **Neon Postgres** plus a **STEAMFORGE** Next.js dashboard. The warehouse stores SteamSpy market snapshots, SCD Type 2 price history (USD / INR), tags, genres, player counts, and review embeddings for semantic search. The dashboard queries that data for charts, community sentiment, tag gaps, and MiniLM + pgvector review search.

**GitHub:** [AryaDuhan/Superheated-Vapor-database](https://github.com/AryaDuhan/Superheated-Vapor-database)

---

## Tech stack map

| Technology | Where / why |
| --- | --- |
| **PostgreSQL (Neon)** | Hosted warehouse. All ETL scripts and the dashboard connect via `DATABASE_URL`. Schema in `sql/schema.sql`. |
| **pgvector + `halfvec(384)`** | Extension enabled in schema. `reviews.review_embedding` stores MiniLM vectors; HNSW index (`halfvec_cosine_ops`) powers cosine KNN semantic search. |
| **Python 3** | ETL and ingest: SteamSpy/Steam fetches, CSV loads, genre backfill, INR prices, embedding pipeline. Root scripts + `data/fetch_*.py`. |
| **psycopg2 / python-dotenv** | DB connectivity and loading `.env` / `venv/.env` in Python scripts. |
| **pandas / requests** | Snapshot handling and HTTP calls to SteamSpy / Steam Store APIs (`requirements.txt`). |
| **sentence-transformers (`all-MiniLM-L6-v2`)** | Offline review embeddings during ETL (`pipeline.py`, `embed_test_batch.py`). Same 384-dim model as the dashboard. |
| **pgvector (Python)** | `register_vector` when inserting/updating embeddings from Python. |
| **SteamSpy API** | Market metadata, owners, CCU, tags, genres, USD prices (`data/fetch_steamspy.py`, `pipeline.py`, `backfill_genres.py`). |
| **Steam Store / Reviews APIs** | English reviews (`pipeline.py`, `data/fetch_review.py`); India store prices via `appdetails?cc=in` (`load_inr_prices.py`). |
| **Next.js 15 / React 19 / TypeScript** | STEAMFORGE UI under `dashboard/` — App Router pages and Route Handlers. |
| **`pg` (node-postgres)** | Server-side SQL from API routes (`dashboard/src/lib/db.ts`). |
| **@xenova/transformers** | In-process MiniLM (`Xenova/all-MiniLM-L6-v2`) for query embeddings at search time (`dashboard/src/lib/embed.ts`). |
| **Recharts** | Charts on Store, Analysis, Sentiment, and game detail pages. |
| **Tailwind CSS 4** | Dashboard styling (`dashboard` PostCSS / globals). |
| **GitHub Actions** | Daily SteamSpy snapshot → Neon (`/.github/workflows/ingest.yml`, 09:00 UTC). |
| **Vercel (optional)** | Deploy `dashboard/` with `DATABASE_URL` set in project env. |

---

## Repo layout

```
.
├── sql/                    # Warehouse DDL and SQL helpers
│   ├── schema.sql          # Tables, vector extension, HNSW index
│   ├── 04_scd2_upsert_price.sql  # upsert_price() SCD2 function
│   ├── 09_indexing.sql     # Extra / performance indexes
│   └── 10_genres.sql       # genres + game_genres migration
├── analysis/               # Analytical SQL (run against Neon)
│   ├── 01_price_history_scd2.sql
│   ├── 02_player_count_trends.sql
│   ├── 03_tag_gap_analysis.sql
│   ├── 04_publisher_hierarchy.sql
│   ├── 05_review_bombing.sql
│   └── 06_indexing_performance.sql
├── data/                   # Fetch scripts + local caches (mostly gitignored)
│   ├── fetch_steamspy.py
│   ├── fetch_appdetails.py
│   └── fetch_review.py
├── dashboard/              # STEAMFORGE Next.js app
│   └── src/
│       ├── app/            # Pages + /api/* Route Handlers
│       ├── components/
│       └── lib/            # db, embed, sentiment, filters
├── pipeline.py             # Resumable full ETL + embeddings
├── load_snapshot.py        # CSV → player_counts + SCD2 USD prices
├── load_inr_prices.py      # Steam India (INR) → price_history
├── insert_data.py          # Load local appdetails/reviews JSON
├── backfill_genres.py      # One-shot SteamSpy genre backfill
├── embed_test_batch.py     # Backfill NULL review_embedding rows
├── requirements.txt
└── .github/workflows/ingest.yml
```

---

## How to run

### 1. Environment

Create a Neon database, run `sql/schema.sql` (and `04_scd2_upsert_price.sql` if not already applied).

**Root ETL** — project `.env` (or `venv/.env`):

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST/DB?sslmode=require
```

**Dashboard** — `dashboard/.env.local` with the same Neon URL:

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST/DB?sslmode=require
```

Do not commit `.env` or `.env.local`. For GitHub Actions daily ingest, store `DATABASE_URL` as a repository secret.

### 2. Python ETL

```powershell
cd steam-sql-analytics
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
# Full pipeline also needs: sentence-transformers, pgvector
pip install sentence-transformers pgvector

python data/fetch_steamspy.py   # write steamspy_snapshot_*.csv
python load_snapshot.py         # player counts + USD SCD2 prices
# Optional longer jobs:
# python pipeline.py            # reviews + embeddings (resumable)
# python load_inr_prices.py
# python backfill_genres.py
```

### 3. Dashboard

```powershell
cd dashboard
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Optional ETL scripts

| Script | Purpose |
| --- | --- |
| `data/fetch_steamspy.py` | Pull SteamSpy “all” pages → `steamspy_snapshot_*.csv` |
| `load_snapshot.py` | Load latest CSV into `player_counts` + `upsert_price` (USD) |
| `pipeline.py` | Per-game SteamSpy details + Steam reviews + MiniLM embeddings (tracks `data/completed_games.txt`) |
| `load_inr_prices.py` | Real INR store prices via Steam `cc=in` into SCD2 `price_history` |
| `backfill_genres.py` | Apply `sql/10_genres.sql` and fill `genres` / `game_genres` from cache or SteamSpy |
| `insert_data.py` | Insert from local `data/appdetails.json` / reviews JSON |
| `embed_test_batch.py` | Encode reviews that still have `review_embedding IS NULL` |
| `data/fetch_appdetails.py` / `data/fetch_review.py` | Standalone fetch helpers for local caches |

Example INR flags:

```powershell
python load_inr_prices.py --limit 50
python load_inr_prices.py --skip-existing --batch-size 20 --delay 1.5
```

---

## Features (STEAMFORGE dashboard)

Nav: **Store · Top · Analysis · Community · Tags · Stats**, plus header game/review search and per-game detail pages.

| Area | Path | What you get |
| --- | --- | --- |
| **Store** | `/` | Catalog overview: game / free / paid counts, positive-review share, top games by CCU, free-vs-paid bar, genre average CCU, sentiment sparkline, ranked lists by major tags (and free-only lists). |
| **Top** | `/top` | Filterable leaderboard: category (genres + niches), price band (free / paid / USD ranges), min CCU, sort (CCU, owners, recommend %, reviews, playtime, name). Shows USD + **INR** when loaded, FREE badge, recommend %, playtime. |
| **Analysis** | `/analysis` | Deep free-vs-paid view: CCU share, top free/paid, genres, reviews, USD price buckets, ownership bands, playtime at review, review volume over time, top studios, **busy niches**, tag co-occurrence. See [Analysis explained](#analysis-explained). |
| **Community** | `/sentiment` | Aggregate Steam recommend/not: overall counts, top games by review mix, daily positive/negative over time. |
| **Tags** | `/market` | Tag co-occurrence pairs + busy-niche table (few games, high avg players). |
| **Stats** | `/signals` | Review-spike days (z-score vs a game’s own baseline) and publisher/studio hierarchy tree. |
| **Semantic search** | `/search` | Type a vibe (“grindy but fair”, “broken multiplayer”); MiniLM embeds the query in-process; pgvector cosine KNN returns similar reviews with similarity + lexicon label. |
| **Header search** | (all pages) | Name search → game hits with CCU/owners; shortcut to “Search reviews for …” → `/search`. |
| **Game detail** | `/game/[appId]` | Description, USD/INR prices, discount, CCU history chart, tag chips, review sentiment bars, sample reviews with lexicon scores. Notes what is *not* in the warehouse (revenue, IAP spend, etc.). |

**Free vs paid (strict):** a game is free when the USD store price is `$0`. A “Free to Play” tag alone does **not** count if the title costs money. Implemented in `dashboard/src/lib/isFree.ts` and used across Store / Top / Analysis APIs.

**INR:** live India store prices come from `load_inr_prices.py` (`appdetails?cc=in`) into SCD2 `price_history` with `currency_code = 'INR'`. Top and game detail show INR beside USD when present.

**Genres & tags:** SteamSpy store genres (`genres` / `game_genres`) plus Steam tags. Analysis majors include official genres (Action, RPG, …) and niches (Horror, Shooter, Survival, …). Non-game/tool apps are filtered out of “real game” rankings.

API Route Handlers under `dashboard/src/app/api/` talk to Neon via `lib/db.ts`. Search uses `lib/embed.ts` then cosine distance on `halfvec`.

---

## Analysis explained

Plain-English meanings for the charts and SQL under `analysis/`.

### Dashboard Analysis page (`/analysis`)

| Chart / section | What it means |
| --- | --- |
| **Players on free vs paid** | Of everyone online in the latest snapshot, how many are on free games vs paid. Share of *players*, not share of *titles*. |
| **Catalog vs CCU share** | Free games may be a small slice of the catalog but a large slice of concurrent players (or the reverse). |
| **Top free / top paid** | Highest CCU titles in each monetization bucket. |
| **Genres** | For each major genre/tag: how many free vs paid games, and how much total / average CCU that genre holds. |
| **Reviews & recommendations** | Overall recommend rate; free vs paid recommend rates; games with the highest recommend % (min review count applied). |
| **Prices (USD buckets)** | Paid games grouped by list-price band; average CCU per band. Price charts stay USD-only; INR is shown on Top / game pages, not in these buckets. |
| **Ownership bands** | SteamSpy owner ranges (e.g. 100k–200k) vs how many games and how much CCU sit in each band. |
| **Hours played at review** | Average playtime *at the time the review was written* (Steam review field), free vs paid — not lifetime hours or money spent. |
| **Reviews over time** | Monthly volume of positive vs negative stored reviews (warehouse coverage, not all of Steam). |
| **Studios with the most players** | Developers ranked by sum / average of latest CCU across their games. |
| **Busy niches** | Tags with relatively **few games** but **high average players** (players-per-game ratio). A hint of demand outpacing supply — not proof of a profitable niche. |
| **Tags that appear together** | How often two major genres/tags share the same game (e.g. Action + Indie). Useful for overlap, not causation. |
| **Spending & IAP** | Explicitly unavailable — the warehouse has no revenue or microtransaction tables. |

### Standalone SQL (`analysis/`)

| File | What it answers |
| --- | --- |
| `01_price_history_scd2.sql` | Point-in-time and current prices using SCD Type 2 (`valid_from` / `valid_to` / `is_current`). Discount frequency once multiple versions exist. |
| `02_player_count_trends.sql` | CCU time series: moving averages, day-over-day change, spike detection once daily ingest has history. |
| `03_tag_gap_analysis.sql` | Tag co-occurrence pairs + market-gap / busy-niche ranking (same idea as Tags + Analysis busy niches). |
| `04_publisher_hierarchy.sql` | Seed + recursive CTE over parent studios (Activision, EA, Ubisoft, …) for the Stats “Studios” tree. |
| `05_review_bombing.sql` | Days where a game’s negative-review count is far above *its own* baseline (z-score threshold) — the Stats “Spikes” feed. |
| `06_indexing_performance.sql` | Index / explain helpers for warehouse query performance. |

---

## CI ingest

`.github/workflows/ingest.yml` runs daily (and on `workflow_dispatch`):

1. `python data/fetch_steamspy.py`
2. `python load_snapshot.py` with `secrets.DATABASE_URL`

---

## License / data

Steam and SteamSpy data remain subject to their respective terms of use. This repo is an analytics warehouse and dashboard project, not an official Valve product.
