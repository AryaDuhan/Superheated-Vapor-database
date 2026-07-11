"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cachedGet, peekCache } from "@/lib/apiCache";
import { formatCount, formatOwners } from "@/lib/format";

type GameRow = {
  app_id: number;
  name: string;
  concurrent_players: number;
  owners_estimate: string;
  base_price_usd: number | null;
  current_price: number | null;
  is_free?: boolean;
};

type Payload = {
  definition?: string;
  catalog?: {
    free_games: number;
    paid_games: number;
    free_share_pct: number;
    paid_share_pct: number;
  };
  ccu?: {
    free_ccu: number;
    paid_ccu: number;
    free_share_pct: number;
    paid_share_pct: number;
    free_games_with_ccu: number;
    paid_games_with_ccu: number;
  };
  topFree?: GameRow[];
  topPaid?: GameRow[];
  genres?: {
    tag_name: string;
    game_count: number;
    free_games: number;
    paid_games: number;
    total_ccu: number;
    avg_ccu: number;
    ccu_share_pct: number;
  }[];
  sentiment?: {
    positive: number;
    negative: number;
    positive_pct: number;
    free: {
      positive: number;
      negative: number;
      positive_pct: number;
      total: number;
    };
    paid: {
      positive: number;
      negative: number;
      positive_pct: number;
      total: number;
    };
  };
  topRecommended?: {
    app_id: number;
    name: string;
    review_count: number;
    positive: number;
    recommend_pct: number;
    is_free: boolean;
  }[];
  priceBuckets?: { bucket: string; game_count: number; avg_ccu: number }[];
  ownersBands?: { band: string; game_count: number; total_ccu: number }[];
  playtime?: {
    free_avg_hours: number;
    paid_avg_hours: number;
    free_reviews: number;
    paid_reviews: number;
    note: string;
  };
  reviewsOverTime?: {
    month: string;
    review_count: number;
    positive: number;
    negative: number;
  }[];
  topDevelopers?: {
    name: string;
    game_count: number;
    total_ccu: number;
    avg_ccu: number;
  }[];
  tagGaps?: {
    tag_name: string;
    num_games: number;
    avg_players: number;
    ratio: number;
  }[];
  priceVsCcu?: { bucket: string; avg_ccu: number; game_count: number }[];
  tagCooccurrence?: {
    tag_a: string;
    tag_b: string;
    co_occurrences: number;
  }[];
  monetization?: {
    spend_data_available: boolean;
    unavailable: string;
  };
  error?: string;
};

const CHART = {
  grid: "rgba(255,255,255,0.14)",
  tick: "#a8a8a8",
  tipBg: "#0a0a0a",
  tipBorder: "rgba(255,255,255,0.4)",
  tipColor: "#e8e8e8",
  free: "#ff5c1a",
  paid: "#8a8a8a",
  accent: "#ff5c1a",
  muted: "#9a9a9a",
  pos: "#3ecf7a",
  neg: "#e05555",
};

function FreeTag() {
  return <span className="free-tag">FREE</span>;
}

function shortTick(name: string, max = 18) {
  if (name.length <= max) return name;
  return `${name.slice(0, max - 1)}…`;
}

function shortBand(band: string, max = 16) {
  const cleaned = band.replace(/\s*\.\.\s*/g, "–").replace(/,/g, "");
  return shortTick(cleaned, max);
}

export default function AnalysisPage() {
  const [data, setData] = useState<Payload | null>(() =>
    peekCache("/api/analysis"),
  );

  useEffect(() => {
    cachedGet<Payload>("/api/analysis")
      .then(setData)
      .catch((e) => setData({ error: String(e) }));
  }, []);

  const loading = !data;
  const statusClass = loading ? "" : data?.error ? "bad" : "ok";
  const statusLabel = loading ? "Loading" : data?.error ? "Error" : "OK";

  const cat = data?.catalog;
  const ccu = data?.ccu;
  const sent = data?.sentiment;
  const play = data?.playtime;

  const tipStyle = useMemo(
    () => ({
      background: CHART.tipBg,
      border: `1px solid ${CHART.tipBorder}`,
      color: CHART.tipColor,
      fontFamily: "var(--font-sans)",
      fontSize: 12,
    }),
    [],
  );

  const ccuShare = useMemo(
    () => [
      { name: "Free", value: ccu?.free_ccu ?? 0, fill: CHART.free },
      { name: "Paid", value: ccu?.paid_ccu ?? 0, fill: CHART.paid },
    ],
    [ccu?.free_ccu, ccu?.paid_ccu],
  );

  const catalogBars = useMemo(
    () => [
      {
        name: "Free",
        games: cat?.free_games ?? 0,
        players: ccu?.free_ccu ?? 0,
        fill: CHART.free,
      },
      {
        name: "Paid",
        games: cat?.paid_games ?? 0,
        players: ccu?.paid_ccu ?? 0,
        fill: CHART.paid,
      },
    ],
    [cat, ccu],
  );

  const compareBars = useMemo(
    () => [
      {
        metric: "Share of catalog",
        Free: cat?.free_share_pct ?? 0,
        Paid: cat?.paid_share_pct ?? 0,
      },
      {
        metric: "Share of players",
        Free: ccu?.free_share_pct ?? 0,
        Paid: ccu?.paid_share_pct ?? 0,
      },
    ],
    [cat, ccu],
  );

  const genreMix = useMemo(
    () =>
      (data?.genres ?? []).map((g) => ({
        name: g.tag_name,
        Free: g.free_games,
        Paid: g.paid_games,
        players: g.total_ccu,
        avg: g.avg_ccu,
      })),
    [data?.genres],
  );

  const sentimentPie = useMemo(
    () => [
      { name: "Recommended", value: sent?.positive ?? 0, fill: CHART.pos },
      { name: "Not recommended", value: sent?.negative ?? 0, fill: CHART.neg },
    ],
    [sent],
  );

  const sentimentByTier = useMemo(
    () => [
      {
        name: "Free",
        Recommended: sent?.free.positive_pct ?? 0,
        "Not recommended": 100 - (sent?.free.positive_pct ?? 0),
      },
      {
        name: "Paid",
        Recommended: sent?.paid.positive_pct ?? 0,
        "Not recommended": 100 - (sent?.paid.positive_pct ?? 0),
      },
    ],
    [sent],
  );

  const playtimeBars = useMemo(
    () => [
      { name: "Free", hours: play?.free_avg_hours ?? 0, fill: CHART.free },
      { name: "Paid", hours: play?.paid_avg_hours ?? 0, fill: CHART.paid },
    ],
    [play],
  );

  const topFreeBars = useMemo(
    () =>
      [...(data?.topFree ?? [])]
        .slice(0, 8)
        .reverse()
        .map((g) => ({
          name: shortTick(g.name, 16),
          full: g.name,
          players: g.concurrent_players,
        })),
    [data?.topFree],
  );

  const topPaidBars = useMemo(
    () =>
      [...(data?.topPaid ?? [])]
        .slice(0, 8)
        .reverse()
        .map((g) => ({
          name: shortTick(g.name, 16),
          full: g.name,
          players: g.concurrent_players,
        })),
    [data?.topPaid],
  );

  return (
    <>
      <section className="hero framed">
        <p className="eyebrow">Analysis</p>
        <h1>Free vs paid players</h1>
        <p>
          A readable look at how free and paid games compare — players online
          now, genres, reviews, prices, and studios. Built only from data we
          actually store.
        </p>
        <div className="callout">
          <strong>Free games</strong> are titles with a $0 store price. A “Free
          to Play” tag alone does not count if the game costs money. Player
          counts are people online now (latest snapshot).
        </div>
        <p className="hero-meta">
          Status: <span className={statusClass}>{statusLabel}</span>
        </p>
      </section>

      {data?.error && <p className="error">{data.error}</p>}

      <div className="stats">
        <div className="stat framed">
          <div className="label">Players on free games</div>
          <div className="sublabel">Online right now</div>
          <div className="value accent">
            {loading ? "…" : formatCount(ccu?.free_ccu)}
          </div>
        </div>
        <div className="stat framed">
          <div className="label">Players on paid games</div>
          <div className="sublabel">Online right now</div>
          <div className="value">
            {loading ? "…" : formatCount(ccu?.paid_ccu)}
          </div>
        </div>
        <div className="stat framed">
          <div className="label">Free share of players</div>
          <div className="sublabel">Of everyone online</div>
          <div className="value">
            {loading ? "…" : `${ccu?.free_share_pct ?? 0}%`}
          </div>
        </div>
        <div className="stat framed">
          <div className="label">Reviews that recommend</div>
          <div className="sublabel">Across stored reviews</div>
          <div className="value">
            {loading ? "…" : `${sent?.positive_pct ?? 0}%`}
          </div>
        </div>
      </div>

      <div className="panel framed">
        <div className="panel-head">
          <h2>How free and paid compare</h2>
        </div>
        <p className="panel-lede">
          Share of the catalog versus share of people actually playing.
        </p>
        <div className="chart-grid">
          <div className="chart-box">
            <h3 className="chart-title">Players online — free vs paid</h3>
            <div className="chart-wrap sm">
              {loading ? (
                <p className="muted">Loading…</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={ccuShare}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={48}
                      outerRadius={78}
                      paddingAngle={2}
                    >
                      {ccuShare.map((d) => (
                        <Cell key={d.name} fill={d.fill} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={tipStyle}
                      formatter={(v) => [formatCount(Number(v)), "Players"]}
                    />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
          <div className="chart-box">
            <h3 className="chart-title">Games in the catalog</h3>
            <div className="chart-wrap sm">
              {loading ? (
                <p className="muted">Loading…</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={catalogBars}>
                    <CartesianGrid stroke={CHART.grid} strokeDasharray="2 4" />
                    <XAxis
                      dataKey="name"
                      tick={{ fill: CHART.tick, fontSize: 12 }}
                    />
                    <YAxis tick={{ fill: CHART.tick, fontSize: 11 }} />
                    <Tooltip
                      contentStyle={tipStyle}
                      formatter={(v) => [formatCount(Number(v)), "Games"]}
                    />
                    <Bar dataKey="games" name="Games">
                      {catalogBars.map((d) => (
                        <Cell key={d.name} fill={d.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
          <div className="chart-box">
            <h3 className="chart-title">Catalog share vs player share</h3>
            <div className="chart-wrap sm">
              {loading ? (
                <p className="muted">Loading…</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={compareBars}>
                    <CartesianGrid stroke={CHART.grid} strokeDasharray="2 4" />
                    <XAxis
                      dataKey="metric"
                      tick={{ fill: CHART.tick, fontSize: 11 }}
                    />
                    <YAxis
                      tick={{ fill: CHART.tick, fontSize: 11 }}
                      unit="%"
                    />
                    <Tooltip contentStyle={tipStyle} />
                    <Legend />
                    <Bar dataKey="Free" fill={CHART.free} />
                    <Bar dataKey="Paid" fill={CHART.paid} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
          <div className="chart-box">
            <h3 className="chart-title">Total players online</h3>
            <div className="chart-wrap sm">
              {loading ? (
                <p className="muted">Loading…</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={catalogBars}>
                    <CartesianGrid stroke={CHART.grid} strokeDasharray="2 4" />
                    <XAxis
                      dataKey="name"
                      tick={{ fill: CHART.tick, fontSize: 12 }}
                    />
                    <YAxis tick={{ fill: CHART.tick, fontSize: 11 }} />
                    <Tooltip
                      contentStyle={tipStyle}
                      formatter={(v) => [formatCount(Number(v)), "Players"]}
                    />
                    <Bar dataKey="players" name="Players">
                      {catalogBars.map((d) => (
                        <Cell key={d.name} fill={d.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="grid-2">
        <div className="panel framed">
          <div className="panel-head">
            <h2>Top free games</h2>
            <span className="status">
              {formatCount(cat?.free_games)} free titles
            </span>
          </div>
          <p className="panel-lede">
            Highest player counts among games with a $0 store price.
          </p>
          <div className="chart-wrap md" style={{ marginBottom: 12 }}>
            {loading ? (
              <p className="muted">Loading…</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topFreeBars} layout="vertical" margin={{ left: 8 }}>
                  <CartesianGrid stroke={CHART.grid} strokeDasharray="2 4" />
                  <XAxis type="number" tick={{ fill: CHART.tick, fontSize: 11 }} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={104}
                    tick={{ fill: CHART.tick, fontSize: 11 }}
                  />
                  <Tooltip
                    contentStyle={tipStyle}
                    formatter={(v) => [formatCount(Number(v)), "Players"]}
                    labelFormatter={(_, payload) =>
                      String(
                        (payload?.[0]?.payload as { full?: string })?.full ?? "",
                      )
                    }
                  />
                  <Bar dataKey="players" fill={CHART.free} name="Players" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
          <table className="data">
            <thead>
              <tr>
                <th>#</th>
                <th>Game</th>
                <th className="num">Players online</th>
                <th className="num">Owners</th>
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
              {(data?.topFree ?? []).map((g, i) => (
                <tr key={g.app_id}>
                  <td className="num">{i + 1}</td>
                  <td>
                    <span className="game-cell">
                      <Link href={`/game/${g.app_id}`} className="game-link">
                        {g.name}
                      </Link>
                      <FreeTag />
                    </span>
                  </td>
                  <td className="num">
                    {formatCount(g.concurrent_players)}
                  </td>
                  <td className="num owners">
                    {formatOwners(g.owners_estimate)}
                  </td>
                </tr>
              ))}
              {!loading && (data?.topFree ?? []).length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    No free titles with player data.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="panel framed">
          <div className="panel-head">
            <h2>Top paid games</h2>
            <span className="status">
              {formatCount(cat?.paid_games)} paid titles
            </span>
          </div>
          <p className="panel-lede">
            Highest player counts among games that cost money on the store.
          </p>
          <div className="chart-wrap md" style={{ marginBottom: 12 }}>
            {loading ? (
              <p className="muted">Loading…</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topPaidBars} layout="vertical" margin={{ left: 8 }}>
                  <CartesianGrid stroke={CHART.grid} strokeDasharray="2 4" />
                  <XAxis type="number" tick={{ fill: CHART.tick, fontSize: 11 }} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={104}
                    tick={{ fill: CHART.tick, fontSize: 11 }}
                  />
                  <Tooltip
                    contentStyle={tipStyle}
                    formatter={(v) => [formatCount(Number(v)), "Players"]}
                    labelFormatter={(_, payload) =>
                      String(
                        (payload?.[0]?.payload as { full?: string })?.full ?? "",
                      )
                    }
                  />
                  <Bar dataKey="players" fill={CHART.paid} name="Players" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
          <table className="data">
            <thead>
              <tr>
                <th>#</th>
                <th>Game</th>
                <th className="num">Players online</th>
                <th className="num">Owners</th>
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
              {(data?.topPaid ?? []).map((g, i) => (
                <tr key={g.app_id}>
                  <td className="num">{i + 1}</td>
                  <td>
                    <Link href={`/game/${g.app_id}`} className="game-link">
                      {g.name}
                    </Link>
                  </td>
                  <td className="num">
                    {formatCount(g.concurrent_players)}
                  </td>
                  <td className="num owners">
                    {formatOwners(g.owners_estimate)}
                  </td>
                </tr>
              ))}
              {!loading && (data?.topPaid ?? []).length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    No paid titles with player data.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel framed">
        <div className="panel-head">
          <h2>Genres</h2>
        </div>
        <p className="panel-lede">
          Which major genres draw the most players, and how free vs paid breaks
          down inside each.
        </p>
        <div className="chart-grid">
          <div className="chart-box">
            <h3 className="chart-title">Players by genre</h3>
            <div className="chart-wrap md">
              {loading ? (
                <p className="muted">Loading…</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={genreMix}>
                    <CartesianGrid stroke={CHART.grid} strokeDasharray="2 4" />
                    <XAxis
                      dataKey="name"
                      tick={{ fill: CHART.tick, fontSize: 10 }}
                      interval={0}
                      angle={-28}
                      textAnchor="end"
                      height={56}
                    />
                    <YAxis tick={{ fill: CHART.tick, fontSize: 11 }} />
                    <Tooltip
                      contentStyle={tipStyle}
                      formatter={(v) => [formatCount(Number(v)), "Players"]}
                    />
                    <Bar dataKey="players" fill={CHART.accent} name="Players" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
          <div className="chart-box">
            <h3 className="chart-title">Free vs paid games by genre</h3>
            <div className="chart-wrap md">
              {loading ? (
                <p className="muted">Loading…</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={genreMix}>
                    <CartesianGrid stroke={CHART.grid} strokeDasharray="2 4" />
                    <XAxis
                      dataKey="name"
                      tick={{ fill: CHART.tick, fontSize: 10 }}
                      interval={0}
                      angle={-28}
                      textAnchor="end"
                      height={56}
                    />
                    <YAxis tick={{ fill: CHART.tick, fontSize: 11 }} />
                    <Tooltip contentStyle={tipStyle} />
                    <Legend />
                    <Bar dataKey="Free" stackId="a" fill={CHART.free} />
                    <Bar dataKey="Paid" stackId="a" fill={CHART.paid} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>
        <table className="data" style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>Genre</th>
              <th className="num">Games</th>
              <th className="num">Free</th>
              <th className="num">Paid</th>
              <th className="num">Players online</th>
              <th className="num">Avg players</th>
              <th className="num">Share</th>
            </tr>
          </thead>
          <tbody>
            {(data?.genres ?? []).map((g) => (
              <tr key={g.tag_name}>
                <td>{g.tag_name}</td>
                <td className="num">{formatCount(g.game_count)}</td>
                <td className="num">{formatCount(g.free_games)}</td>
                <td className="num">{formatCount(g.paid_games)}</td>
                <td className="num">{formatCount(g.total_ccu)}</td>
                <td className="num">{formatCount(g.avg_ccu)}</td>
                <td className="num">{g.ccu_share_pct}%</td>
              </tr>
            ))}
            {!loading && (data?.genres ?? []).length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  No genre data yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="panel framed">
        <div className="panel-head">
          <h2>Reviews & recommendations</h2>
        </div>
        <p className="panel-lede">
          How often players recommend free vs paid games, plus the highest-rated
          titles with enough reviews.
        </p>
        <div className="chart-grid">
          <div className="chart-box">
            <h3 className="chart-title">All reviews</h3>
            <div className="chart-wrap sm">
              {loading ? (
                <p className="muted">Loading…</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={sentimentPie}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={44}
                      outerRadius={72}
                      paddingAngle={2}
                    >
                      {sentimentPie.map((d) => (
                        <Cell key={d.name} fill={d.fill} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={tipStyle}
                      formatter={(v) => [formatCount(Number(v)), "Reviews"]}
                    />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
          <div className="chart-box">
            <h3 className="chart-title">Recommend rate — free vs paid</h3>
            <div className="chart-wrap sm">
              {loading ? (
                <p className="muted">Loading…</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={sentimentByTier}>
                    <CartesianGrid stroke={CHART.grid} strokeDasharray="2 4" />
                    <XAxis
                      dataKey="name"
                      tick={{ fill: CHART.tick, fontSize: 12 }}
                    />
                    <YAxis
                      tick={{ fill: CHART.tick, fontSize: 11 }}
                      unit="%"
                      domain={[0, 100]}
                    />
                    <Tooltip contentStyle={tipStyle} />
                    <Legend />
                    <Bar dataKey="Recommended" stackId="s" fill={CHART.pos} />
                    <Bar
                      dataKey="Not recommended"
                      stackId="s"
                      fill={CHART.neg}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>
        <table className="data" style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>#</th>
              <th>Game</th>
              <th className="num">Recommend rate</th>
              <th className="num">Reviews</th>
            </tr>
          </thead>
          <tbody>
            {(data?.topRecommended ?? []).map((g, i) => (
              <tr key={g.app_id}>
                <td className="num">{i + 1}</td>
                <td>
                  <span className="game-cell">
                    <Link href={`/game/${g.app_id}`} className="game-link">
                      {g.name}
                    </Link>
                    {g.is_free ? <FreeTag /> : null}
                  </span>
                </td>
                <td className="num">{g.recommend_pct}%</td>
                <td className="num">{formatCount(g.review_count)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel framed">
        <div className="panel-head">
          <h2>Prices</h2>
        </div>
        <p className="panel-lede">
          How paid games cluster by USD list price, and whether pricier buckets tend
          to have more players online. Price buckets stay USD-only; INR live prices
          appear on game and top lists when ingested.
        </p>
        <div className="chart-grid">
          <div className="chart-box">
            <h3 className="chart-title">Paid games by list price</h3>
            <div className="chart-wrap sm">
              {loading ? (
                <p className="muted">Loading…</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data?.priceBuckets ?? []}>
                    <CartesianGrid stroke={CHART.grid} strokeDasharray="2 4" />
                    <XAxis
                      dataKey="bucket"
                      tick={{ fill: CHART.tick, fontSize: 11 }}
                    />
                    <YAxis tick={{ fill: CHART.tick, fontSize: 11 }} />
                    <Tooltip
                      contentStyle={tipStyle}
                      formatter={(v) => [formatCount(Number(v)), "Games"]}
                    />
                    <Bar dataKey="game_count" fill={CHART.accent} name="Games" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
          <div className="chart-box">
            <h3 className="chart-title">Average players by price range</h3>
            <div className="chart-wrap sm">
              {loading ? (
                <p className="muted">Loading…</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data?.priceVsCcu ?? []}>
                    <CartesianGrid stroke={CHART.grid} strokeDasharray="2 4" />
                    <XAxis
                      dataKey="bucket"
                      tick={{ fill: CHART.tick, fontSize: 11 }}
                    />
                    <YAxis tick={{ fill: CHART.tick, fontSize: 11 }} />
                    <Tooltip
                      contentStyle={tipStyle}
                      formatter={(v) => [
                        formatCount(Number(v)),
                        "Avg players",
                      ]}
                    />
                    <Line
                      type="monotone"
                      dataKey="avg_ccu"
                      name="Avg players"
                      stroke={CHART.accent}
                      strokeWidth={2}
                      dot={{ r: 3, fill: CHART.accent }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="panel framed">
        <div className="panel-head">
          <h2>Ownership bands</h2>
        </div>
        <p className="panel-lede">
          Rough owner ranges from SteamSpy-style estimates (not exact sales).
        </p>
        <div className="chart-wrap md">
          {loading ? (
            <p className="muted">Loading…</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={(data?.ownersBands ?? []).map((b) => ({
                  ...b,
                  label: shortBand(b.band, 14),
                  full: b.band,
                }))}
              >
                <CartesianGrid stroke={CHART.grid} strokeDasharray="2 4" />
                <XAxis
                  dataKey="label"
                  tick={{ fill: CHART.tick, fontSize: 10 }}
                  interval={0}
                  angle={-24}
                  textAnchor="end"
                  height={52}
                />
                <YAxis tick={{ fill: CHART.tick, fontSize: 11 }} />
                <Tooltip
                  contentStyle={tipStyle}
                  formatter={(v) => [formatCount(Number(v)), "Games"]}
                  labelFormatter={(_, payload) =>
                    String(
                      (payload?.[0]?.payload as { full?: string })?.full ?? "",
                    )
                  }
                />
                <Bar dataKey="game_count" fill={CHART.muted} name="Games" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="grid-2">
        <div className="panel framed">
          <div className="panel-head">
            <h2>Hours played at review</h2>
          </div>
          <p className="panel-lede">
            Average playtime when someone left a review — free vs paid.
          </p>
          <div className="chart-wrap sm">
            {loading ? (
              <p className="muted">Loading…</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={playtimeBars}>
                  <CartesianGrid stroke={CHART.grid} strokeDasharray="2 4" />
                  <XAxis
                    dataKey="name"
                    tick={{ fill: CHART.tick, fontSize: 12 }}
                  />
                  <YAxis tick={{ fill: CHART.tick, fontSize: 11 }} />
                  <Tooltip
                    contentStyle={tipStyle}
                    formatter={(v) => [`${Number(v)} h`, "Average"]}
                  />
                  <Bar dataKey="hours" name="Hours">
                    {playtimeBars.map((d) => (
                      <Cell key={d.name} fill={d.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
          <p className="muted" style={{ marginTop: 8, maxWidth: "60ch" }}>
            This is playtime at review time only — not in-game spending. We do
            not have purchase or microtransaction data.
          </p>
        </div>

        <div className="panel framed">
          <div className="panel-head">
            <h2>Reviews over time</h2>
          </div>
          <p className="panel-lede">
            Monthly volume of recommended vs not-recommended reviews.
          </p>
          <div className="chart-wrap md">
            {loading ? (
              <p className="muted">Loading…</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data?.reviewsOverTime ?? []}>
                  <CartesianGrid stroke={CHART.grid} strokeDasharray="2 4" />
                  <XAxis
                    dataKey="month"
                    tick={{ fill: CHART.tick, fontSize: 10 }}
                    interval="preserveStartEnd"
                  />
                  <YAxis tick={{ fill: CHART.tick, fontSize: 11 }} />
                  <Tooltip
                    contentStyle={tipStyle}
                    formatter={(v) => [formatCount(Number(v))]}
                  />
                  <Area
                    type="monotone"
                    dataKey="positive"
                    stackId="1"
                    stroke={CHART.pos}
                    fill={CHART.pos}
                    fillOpacity={0.45}
                    name="Recommended"
                  />
                  <Area
                    type="monotone"
                    dataKey="negative"
                    stackId="1"
                    stroke={CHART.neg}
                    fill={CHART.neg}
                    fillOpacity={0.45}
                    name="Not recommended"
                  />
                  <Legend />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      <div className="grid-2">
        <div className="panel framed">
          <div className="panel-head">
            <h2>Studios with the most players</h2>
          </div>
          <p className="panel-lede">
            Developers whose games add up to the highest player totals (2+
            titles).
          </p>
          <div className="chart-wrap md" style={{ marginBottom: 12 }}>
            {loading ? (
              <p className="muted">Loading…</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={[...(data?.topDevelopers ?? [])]
                    .slice(0, 8)
                    .reverse()
                    .map((d) => ({
                      name: shortTick(d.name, 14),
                      full: d.name,
                      players: d.total_ccu,
                    }))}
                  layout="vertical"
                  margin={{ left: 8 }}
                >
                  <CartesianGrid stroke={CHART.grid} strokeDasharray="2 4" />
                  <XAxis type="number" tick={{ fill: CHART.tick, fontSize: 11 }} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={96}
                    tick={{ fill: CHART.tick, fontSize: 11 }}
                  />
                  <Tooltip
                    contentStyle={tipStyle}
                    formatter={(v) => [formatCount(Number(v)), "Players"]}
                    labelFormatter={(_, payload) =>
                      String(
                        (payload?.[0]?.payload as { full?: string })?.full ?? "",
                      )
                    }
                  />
                  <Bar dataKey="players" fill={CHART.accent} name="Players" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
          <table className="data">
            <thead>
              <tr>
                <th>Studio</th>
                <th className="num">Games</th>
                <th className="num">Players online</th>
                <th className="num">Avg players</th>
              </tr>
            </thead>
            <tbody>
              {(data?.topDevelopers ?? []).map((d) => (
                <tr key={d.name}>
                  <td>{d.name}</td>
                  <td className="num">{formatCount(d.game_count)}</td>
                  <td className="num">{formatCount(d.total_ccu)}</td>
                  <td className="num">{formatCount(d.avg_ccu)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel framed">
          <div className="panel-head">
            <h2>Busy niches</h2>
          </div>
          <p className="panel-lede">
            Tags with relatively few games but high average players — possible
            demand gaps.
          </p>
          <div className="chart-wrap md" style={{ marginBottom: 12 }}>
            {loading ? (
              <p className="muted">Loading…</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data?.tagGaps ?? []}>
                  <CartesianGrid stroke={CHART.grid} strokeDasharray="2 4" />
                  <XAxis
                    dataKey="tag_name"
                    tick={{ fill: CHART.tick, fontSize: 10 }}
                    interval={0}
                    angle={-28}
                    textAnchor="end"
                    height={56}
                  />
                  <YAxis tick={{ fill: CHART.tick, fontSize: 11 }} />
                  <Tooltip contentStyle={tipStyle} />
                  <Bar
                    dataKey="ratio"
                    fill={CHART.accent}
                    name="Players per game"
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
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
              {(data?.tagGaps ?? []).map((t) => (
                <tr key={t.tag_name}>
                  <td>{t.tag_name}</td>
                  <td className="num">{formatCount(t.num_games)}</td>
                  <td className="num">{formatCount(t.avg_players)}</td>
                  <td className="num">{t.ratio}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel framed">
        <div className="panel-head">
          <h2>Tags that appear together</h2>
        </div>
        <p className="panel-lede">
          Common pairs among major genres — useful for seeing how categories
          overlap.
        </p>
        <table className="data">
          <thead>
            <tr>
              <th>#</th>
              <th>Tag A</th>
              <th>Tag B</th>
              <th className="num">Shared games</th>
            </tr>
          </thead>
          <tbody>
            {(data?.tagCooccurrence ?? []).map((p, i) => (
              <tr key={`${p.tag_a}-${p.tag_b}`}>
                <td className="num">{i + 1}</td>
                <td>{p.tag_a}</td>
                <td>{p.tag_b}</td>
                <td className="num">{formatCount(p.co_occurrences)}</td>
              </tr>
            ))}
            {!loading && (data?.tagCooccurrence ?? []).length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  No overlapping genre pairs found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="panel framed">
        <div className="panel-head">
          <h2>Spending & in-app purchases</h2>
        </div>
        <p className="panel-lede">
          We cannot show revenue or microtransaction spend — those tables are
          not in this database. Charts above stick to prices, players, reviews,
          and tags we do have.
        </p>
      </div>
    </>
  );
}
