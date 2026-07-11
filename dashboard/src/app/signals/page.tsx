"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { cachedGet, peekCache } from "@/lib/apiCache";
import { formatCount } from "@/lib/format";

type Payload = {
  bombs: {
    app_id: number;
    name: string;
    review_day: string;
    negative_count: string;
    total_count: string;
    z_score: string;
  }[];
  studios: { path: string; depth: string; game_count: string }[];
  error?: string;
};

type Feed = "spikes" | "studios";

function slug(name: string) {
  return name.replace(/\s+/g, "_");
}

export default function SignalsPage() {
  const [data, setData] = useState<Payload | null>(() =>
    peekCache("/api/signals"),
  );
  const [feed, setFeed] = useState<Feed>("spikes");

  useEffect(() => {
    cachedGet<Payload>("/api/signals")
      .then(setData)
      .catch((e) => setData({ error: String(e) } as Payload));
  }, []);

  const loading = !data;
  const bombs = data?.bombs ?? [];
  const studios = data?.studios ?? [];

  return (
    <>
      <section className="hero framed">
        <p className="eyebrow">Stats</p>
        <h1>Activity signals</h1>
        <p>
          Games with unusual negative-review activity, plus publisher and studio
          relationships.
        </p>
        <p className="hero-meta">
          Status: {loading ? "Loading" : data?.error ? "Error" : "Ok"}
        </p>
      </section>

      {data?.error && <p className="error">{data.error}</p>}

      <div className="panel framed">
        <div className="panel-head">
          <h2>
            {feed === "spikes" ? "Review spikes" : "Studio tree"}
          </h2>
          <span className="status">Live feed</span>
        </div>
        <div className="toggle-row" role="tablist">
          <button
            type="button"
            className={feed === "spikes" ? "toggle active" : "toggle"}
            onClick={() => setFeed("spikes")}
          >
            Spikes
          </button>
          <button
            type="button"
            className={feed === "studios" ? "toggle active" : "toggle"}
            onClick={() => setFeed("studios")}
          >
            Studios
          </button>
        </div>

        {feed === "spikes" ? (
          loading ? (
            <p className="muted">Loading…</p>
          ) : bombs.length === 0 ? (
            <p className="muted">
              No spikes yet (needs denser multi-day review history).
            </p>
          ) : (
            <ul className="feed">
              {bombs.map((b) => (
                <li
                  key={`${b.app_id}-${b.review_day}`}
                  className="feed-item"
                >
                  <span className="feed-mark" aria-hidden />
                  <div>
                    <p className="feed-title">
                      <Link
                        href={`/game/${b.app_id}`}
                        className="game-link"
                      >
                        {slug(b.name)}
                      </Link>{" "}
                      // Neg_Spike
                    </p>
                    <p className="feed-meta">
                      z {b.z_score} · neg {formatCount(b.negative_count)} /{" "}
                      {formatCount(b.total_count)}
                    </p>
                  </div>
                  <span className="feed-time">{b.review_day}</span>
                </li>
              ))}
            </ul>
          )
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Path</th>
                <th className="num">Depth</th>
                <th className="num">Games</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={3} className="muted">
                    Loading…
                  </td>
                </tr>
              )}
              {studios.map((s) => (
                <tr key={s.path}>
                  <td>{s.path}</td>
                  <td className="num">{s.depth}</td>
                  <td className="num">{formatCount(s.game_count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
