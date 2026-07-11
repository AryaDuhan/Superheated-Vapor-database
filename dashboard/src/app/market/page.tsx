"use client";

import { useEffect, useState } from "react";
import { cachedGet, peekCache } from "@/lib/apiCache";
import { formatCount } from "@/lib/format";

type Payload = {
  pairs: { tag_a: string; tag_b: string; co_occurrences: string }[];
  gaps: {
    tag_name: string;
    num_games: string;
    avg_players: string;
    ratio: string;
  }[];
  error?: string;
};

export default function MarketPage() {
  const [data, setData] = useState<Payload | null>(() =>
    peekCache("/api/market"),
  );

  useEffect(() => {
    cachedGet<Payload>("/api/market")
      .then(setData)
      .catch((e) => setData({ error: String(e) } as Payload));
  }, []);

  const loading = !data;

  return (
    <>
      <section className="hero framed">
        <p className="eyebrow">Tags</p>
        <h1>Tag market</h1>
        <p>
          Which tags show up together, and which niches have lots of players for
          relatively few games.
        </p>
        <p className="hero-meta">
          Status: {loading ? "Loading" : data?.error ? "Error" : "Ok"}
        </p>
      </section>

      {data?.error && <p className="error">{data.error}</p>}

      <div className="grid-2">
        <div className="panel framed">
          <div className="panel-head">
            <h2>Tags that appear together</h2>
            <span className="status">Common pairs</span>
          </div>
          <table className="data">
            <thead>
              <tr>
                <th>Tag A</th>
                <th>Tag B</th>
                <th className="num">Count</th>
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
              {(data?.pairs ?? []).map((p) => (
                <tr key={`${p.tag_a}-${p.tag_b}`}>
                  <td>{p.tag_a}</td>
                  <td>{p.tag_b}</td>
                  <td className="num">{formatCount(p.co_occurrences)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="panel framed">
          <div className="panel-head">
            <h2>High-demand tags</h2>
            <span className="status">Players relative to supply</span>
          </div>
          <table className="data">
            <thead>
              <tr>
                <th>Tag</th>
                <th className="num">Games</th>
                <th className="num">Avg players</th>
                <th className="num">Players / game</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={4} className="muted">
                    Loading…
                  </td>
                </tr>
              )}
              {(data?.gaps ?? []).map((g) => (
                <tr key={g.tag_name}>
                  <td>{g.tag_name}</td>
                  <td className="num">{formatCount(g.num_games)}</td>
                  <td className="num">{formatCount(Number(g.avg_players))}</td>
                  <td className="num">{g.ratio}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
