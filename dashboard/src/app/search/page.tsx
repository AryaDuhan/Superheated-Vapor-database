"use client";

import Link from "next/link";
import { FormEvent, Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type Result = {
  review_id: string;
  app_id: number;
  name: string;
  review_text: string;
  is_positive: boolean;
  similarity: number;
  lexicon: { label: string; score: number };
};

function SearchPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlQ = searchParams.get("q") ?? "";
  const [q, setQ] = useState(urlQ);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    setQ(urlQ);
  }, [urlQ]);

  const runSearch = useCallback(async (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) return;

    setLoading(true);
    setError("");
    setSearched(true);
    try {
      // Warm only when the user actually runs a review search.
      void fetch("/api/search/warm").catch(() => {});

      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: trimmed, limit: 12 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Search failed");
      setResults(data.results ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!urlQ.trim()) return;
    void runSearch(urlQ);
  }, [urlQ, runSearch]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = q.trim();
    if (!trimmed) return;
    if (trimmed === urlQ.trim()) {
      void runSearch(trimmed);
      return;
    }
    router.replace(`/search?q=${encodeURIComponent(trimmed)}`);
  }

  return (
    <>
      <section className="hero framed">
        <p className="eyebrow">Search</p>
        <h1>Search reviews</h1>
        <p>
          Semantic review search via MiniLM embeddings ranked with pgvector
          cosine similarity. Game name search lives in the header bar.
        </p>
      </section>

      <form className="search-row" onSubmit={onSubmit}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Describe a review vibe…"
        />
        <button type="submit" disabled={loading || !q.trim()}>
          {loading ? "Searching…" : "Search reviews"}
        </button>
      </form>

      {error && <p className="error">{error}</p>}
      {loading && (
        <p className="muted">
          Loading embedding model / searching similar reviews…
        </p>
      )}

      <div className="panel framed">
        <div className="panel-head">
          <h2>Results</h2>
          <span className="status">
            {results.length
              ? `${results.length} hits`
              : searched
                ? "No_Hits"
                : "Awaiting_Query"}
          </span>
        </div>
        {results.length === 0 && !loading && (
          <p className="muted">
            {searched
              ? "No similar reviews found for that query."
              : "Run a search to retrieve similar player reviews."}
          </p>
        )}
        {results.map((r) => (
          <article key={r.review_id} className="hit">
            <div className="meta">
              <strong>
                <Link href={`/game/${r.app_id}`} className="game-link">
                  {r.name}
                </Link>
              </strong>
              <span className="muted">
                sim {(r.similarity * 100).toFixed(1)}%
              </span>
              <span className={r.is_positive ? "pill pos" : "pill neg"}>
                {r.is_positive ? "Recommended" : "Not Recommended"}
              </span>
              <span className="pill">{r.lexicon.label}</span>
            </div>
            <p>{r.review_text}</p>
          </article>
        ))}
      </div>
    </>
  );
}

export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <section className="hero framed">
          <p className="eyebrow">Search</p>
          <h1>Search reviews</h1>
          <p className="muted">Loading…</p>
        </section>
      }
    >
      <SearchPageInner />
    </Suspense>
  );
}
