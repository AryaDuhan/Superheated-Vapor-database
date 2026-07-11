# STEAMFORGE Dashboard

Next.js app on Neon Postgres with:

- Overview metrics + top CCU / market gaps
- **Semantic search** — `all-MiniLM-L6-v2` embeddings + pgvector `halfvec` cosine KNN
- **Sentiment** — Steam `voted_up` aggregates (SQL) + lexicon overlay on search hits
- Tag co-occurrence, review-bomb z-scores, studio hierarchy

## Local

```powershell
cd dashboard
# set DATABASE_URL in .env.local (same Neon string as the ETL .env)
npm install
npm run dev
```

Open http://localhost:3000

## Vercel

```powershell
cd dashboard
npx vercel
```

Add env var `DATABASE_URL` in the Vercel project settings (Neon connection string with `?sslmode=require`).

Root Directory: `dashboard` if the Git repo is `steam-sql-analytics`.
