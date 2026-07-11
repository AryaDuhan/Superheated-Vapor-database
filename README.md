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

## Dashboard routes (high level)

| Path | Role |
| --- | --- |
| `/` | Store overview + Recharts |
| `/top` | Top games by CCU / filters |
| `/analysis` | Analytical charts |
| `/sentiment` | Community / review aggregates |
| `/market` | Tag market views |
| `/signals` | Stats / signals |
| `/search` | Semantic review search (MiniLM query → pgvector KNN) |
| `/game/[appId]` | Per-game detail |

API Route Handlers under `dashboard/src/app/api/` talk to Neon through `lib/db.ts`. Search uses `lib/embed.ts` then cosine distance on `halfvec`.

---

## CI ingest

`.github/workflows/ingest.yml` runs daily (and on `workflow_dispatch`):

1. `python data/fetch_steamspy.py`
2. `python load_snapshot.py` with `secrets.DATABASE_URL`

---

## License / data

Steam and SteamSpy data remain subject to their respective terms of use. This repo is an analytics warehouse and dashboard project, not an official Valve product.
