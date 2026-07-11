# Steam SQL Analytics

Neon Postgres warehouse for SteamSpy + Steam reviews, with SCD2 prices, window-function time series, tag gap analysis, recursive studio trees, review-bomb detection, and a **STEAMFORGE** Next.js dashboard (semantic search + sentiment).

## Layout

- `sql/` — schema, SCD2 `upsert_price`, indexes
- `analysis/` — Phase 4–8 SQL
- `data/` — fetch scripts + local snapshots (gitignored)
- `pipeline.py` — resumable ETL + embeddings
- `load_snapshot.py` — daily CSV → `player_counts` + SCD2 prices
- `.github/workflows/ingest.yml` — scheduled SteamSpy ingest
- `dashboard/` — Vercel/Next.js UI

## Quick start

```powershell
cd steam-sql-analytics
.\venv\Scripts\Activate.ps1
# DATABASE_URL in .env
python pipeline.py          # full ETL (long-running)
cd dashboard
npm install
npm run dev
```

## GitHub Actions

Repo secret: `DATABASE_URL` → enables daily SteamSpy ingest at 09:00 UTC.
