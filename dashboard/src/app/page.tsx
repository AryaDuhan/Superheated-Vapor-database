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
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cachedGet, peekCache } from "@/lib/apiCache";
import { formatCount, formatFullCount, formatOwners } from "@/lib/format";

type StatsPayload = {
  stats: {
    games: string;
    reviews: string;
    tags: string;
    developers: string;
    pos: string;
    neg: string;
    free?: string;
    paid?: string;
  };
  topGames: {
    app_id: number;
    name: string;
    concurrent_players: number;
    owners_estimate: string;
    is_free?: boolean;
  }[];
  tagGaps: {
    tag_name: string;
    num_games: string;
    avg_players: string;
    ratio: string;
  }[];
  freePaid?: { free: number; paid: number };
  error?: string;
};

type RankedGame = {
  app_id: number;
  name: string;
  concurrent_players: number;
  owners_estimate: string;
  rank: number;
  is_free?: boolean;
};

type Category = {
  tag_id: number;
  tag_name: string;
  num_games: number;
  avg_ccu: number;
};

type CategoryPayload = {
  categories: Category[];
  byTag: Record<string, RankedGame[]>;
  freeCategories?: Category[];
  byTagFree?: Record<string, RankedGame[]>;
  topFree?: RankedGame[];
  error?: string;
};

type SentimentPayload = {
  overall: { positive: string; negative: string; total: string };
  daily: { day: string; positive: string; negative: string }[];
  error?: string;
};

const CHART = {
  grid: "rgba(255,255,255,0.12)",
  tick: "#7a7a7a",
  label: "#c8c8c8",
  tipBg: "#000",
  tipBorder: "rgba(255,255,255,0.35)",
  tipColor: "#d4d4d4",
  accent: "#ff5c1a",
  white: "#ffffff",
  gray: "#666666",
  ok: "#3ecf7a",
  bad: "#e05555",
};

function avgCcuLabel(n: number) {
  const c = formatCount(n);
  return c === "—" ? "—" : c;
}

function sortedGames(list: RankedGame[] | undefined) {
  return [...(list ?? [])].sort((a, b) => a.rank - b.rank);
}

function shortTick(name: string, max = 22) {
  if (name.length <= max) return name;
  return `${name.slice(0, max - 1)}…`;
}

function formatCatMeta(numGames: number, avgCcu: number) {
  return `${formatCount(numGames)} games · avg ${avgCcuLabel(avgCcu)} players`;
}

function FreeTag() {
  return <span className="free-tag">FREE</span>;
}

function RankList({
  games,
  empty = "No games in this category.",
}: {
  games: RankedGame[];
  empty?: string;
}) {
  const ordered = sortedGames(games);
  return (
    <ol className="rank-list">
      <li className="rank-head"># · Game</li>
      {ordered.length === 0 && <li className="rank-empty muted">{empty}</li>}
      {ordered.map((g) => (
        <li key={g.app_id} className="rank-row">
          <span className={g.rank === 1 ? "rank-n top" : "rank-n"}>
            {g.rank}
          </span>
          <span className="rank-main">
            <Link href={`/game/${g.app_id}`} className="rank-name">
              {g.name}
            </Link>
            {g.is_free ? <FreeTag /> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

function CategoryCard({
  title,
  meta,
  games,
}: {
  title: string;
  meta: string;
  games: RankedGame[];
}) {
  return (
    <article className="cat-card framed">
      <header className="cat-card-head">
        <h3>{title}</h3>
        <p className="cat-card-meta">{meta}</p>
      </header>
      <RankList games={games} />
    </article>
  );
}

export default function HomePage() {
  const cachedCats = peekCache<CategoryPayload>("/api/top-by-category");
  const [data, setData] = useState<StatsPayload | null>(() =>
    peekCache("/api/stats"),
  );
  const [cats, setCats] = useState<CategoryPayload | null>(() => cachedCats);
  const [sentiment, setSentiment] = useState<SentimentPayload | null>(() =>
    peekCache("/api/sentiment"),
  );

  useEffect(() => {
    cachedGet<StatsPayload>("/api/stats")
      .then(setData)
      .catch((e) => setData({ error: String(e) } as StatsPayload));
    cachedGet<CategoryPayload>("/api/top-by-category")
      .then(setCats)
      .catch((e) =>
        setCats({ error: String(e), categories: [], byTag: {} }),
      );
    cachedGet<SentimentPayload>("/api/sentiment")
      .then(setSentiment)
      .catch(() => setSentiment(null));
  }, []);

  const s = data?.stats;
  const pos = Number(s?.pos ?? 0);
  const neg = Number(s?.neg ?? 0);
  const total = pos + neg;
  const posPct = total ? ((100 * pos) / total).toFixed(1) : "—";
  const loading = !data;
  const statusClass = loading ? "" : data?.error ? "bad" : "ok";
  const statusLabel = loading ? "Loading" : data?.error ? "Error" : "Ok";

  const freeN = data?.freePaid?.free ?? Number(s?.free ?? 0);
  const paidN = data?.freePaid?.paid ?? Number(s?.paid ?? 0);

  const tipStyle = useMemo(
    () => ({
      background: CHART.tipBg,
      border: `1px solid ${CHART.tipBorder}`,
      color: CHART.tipColor,
      fontFamily: "var(--font-mono)",
      fontSize: 11,
    }),
    [],
  );

  const ccuChart = useMemo(
    () =>
      (data?.topGames ?? []).map((g) => ({
        name: shortTick(g.name, 22),
        full: g.name,
        app_id: g.app_id,
        ccu: Number(g.concurrent_players) || 0,
        is_free: !!g.is_free,
      })),
    [data?.topGames],
  );

  const freePaidChart = useMemo(
    () => [
      { name: "Free", count: freeN, fill: CHART.accent },
      { name: "Paid", count: paidN, fill: CHART.gray },
    ],
    [freeN, paidN],
  );

  const genreCcuChart = useMemo(
    () =>
      (cats?.categories ?? []).map((c) => ({
        name: shortTick(c.tag_name, 12),
        avg_ccu: Math.round(c.avg_ccu),
        games: c.num_games,
      })),
    [cats?.categories],
  );

  const sentimentSplit = useMemo(
    () => [
      { name: "Positive", count: pos, fill: CHART.ok },
      { name: "Negative", count: neg, fill: CHART.bad },
    ],
    [pos, neg],
  );

  const sparkDaily = useMemo(
    () =>
      (sentiment?.daily ?? []).slice(-21).map((d) => ({
        day: d.day.slice(5),
        positive: Number(d.positive) || 0,
        negative: Number(d.negative) || 0,
      })),
    [sentiment?.daily],
  );

  const topFree = useMemo(
    () => sortedGames(cats?.topFree),
    [cats?.topFree],
  );

  return (
    <>
      <section className="hero framed">
        <p className="eyebrow">Store</p>
        <h1>Steam overview</h1>
        <p>
          Players online now, ownership bands, top genres, and free vs paid
          titles from the live catalog.
        </p>
        <p className="hero-meta">
          Status: <span className={statusClass}>{statusLabel}</span>
        </p>
      </section>

      {data?.error && <p className="error">{data.error}</p>}

      <div className="stats">
        <div className="stat framed">
          <div className="label">Games</div>
          <div className="sublabel">Live</div>
          <div className="value accent">
            {loading ? "…" : formatFullCount(s?.games)}
          </div>
        </div>
        <div className="stat framed">
          <div className="label">Free</div>
          <div className="sublabel">$0 store price</div>
          <div className="value">
            {loading ? "…" : formatFullCount(freeN)}
          </div>
        </div>
        <div className="stat framed">
          <div className="label">Paid</div>
          <div className="sublabel">Catalog</div>
          <div className="value">
            {loading ? "…" : formatFullCount(paidN)}
          </div>
        </div>
        <div className="stat framed">
          <div className="label">Positive</div>
          <div className="sublabel">Share</div>
          <div className="value">{loading ? "…" : `${posPct}%`}</div>
        </div>
      </div>

      <div className="panel framed">
        <div className="panel-head">
          <h2>Overview charts</h2>
          <span className="status">Players, reviews, free vs paid, genres</span>
        </div>
        <div className="chart-grid">
          <div className="chart-box">
            <h3 className="chart-title">Top games by players online</h3>
            <div className="chart-wrap md">
              {loading ? (
                <p className="muted">Loading…</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={ccuChart}
                    layout="vertical"
                    margin={{ left: 8, right: 12, top: 4, bottom: 4 }}
                  >
                    <CartesianGrid
                      stroke={CHART.grid}
                      strokeDasharray="2 4"
                      horizontal={false}
                    />
                    <XAxis
                      type="number"
                      tick={{ fill: CHART.tick, fontSize: 10 }}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={148}
                      interval={0}
                      tick={{ fill: CHART.label, fontSize: 12 }}
                    />
                    <Tooltip
                      contentStyle={tipStyle}
                      formatter={(v) => [formatCount(Number(v)), "CCU"]}
                      labelFormatter={(_, payload) => {
                        const row = payload?.[0]?.payload as
                          | { full?: string; is_free?: boolean }
                          | undefined;
                        const label = String(row?.full ?? "");
                        return row?.is_free ? `${label} · FREE` : label;
                      }}
                    />
                    <Bar dataKey="ccu" fill={CHART.accent} name="CCU" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="chart-box">
            <h3 className="chart-title">Reviews — recommended vs not</h3>
            <div className="chart-wrap sm">
              {loading ? (
                <p className="muted">Loading…</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={sentimentSplit}
                    margin={{ left: 0, right: 8, top: 8, bottom: 4 }}
                  >
                    <CartesianGrid stroke={CHART.grid} strokeDasharray="2 4" />
                    <XAxis
                      dataKey="name"
                      tick={{ fill: CHART.tick, fontSize: 10 }}
                    />
                    <YAxis tick={{ fill: CHART.tick, fontSize: 10 }} />
                    <Tooltip
                      contentStyle={tipStyle}
                      formatter={(v) => [formatCount(Number(v)), "Reviews"]}
                    />
                    <Bar dataKey="count" name="Reviews">
                      {sentimentSplit.map((d) => (
                        <Cell key={d.name} fill={d.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="chart-box">
            <h3 className="chart-title">Catalog — free vs paid</h3>
            <div className="chart-wrap sm">
              {loading ? (
                <p className="muted">Loading…</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={freePaidChart}
                    margin={{ left: 0, right: 8, top: 8, bottom: 4 }}
                  >
                    <CartesianGrid stroke={CHART.grid} strokeDasharray="2 4" />
                    <XAxis
                      dataKey="name"
                      tick={{ fill: CHART.tick, fontSize: 10 }}
                    />
                    <YAxis tick={{ fill: CHART.tick, fontSize: 10 }} />
                    <Tooltip
                      contentStyle={tipStyle}
                      formatter={(v) => [formatCount(Number(v)), "Games"]}
                    />
                    <Bar dataKey="count" name="Games">
                      {freePaidChart.map((d) => (
                        <Cell key={d.name} fill={d.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="chart-box">
            <h3 className="chart-title">Average players by genre</h3>
            <div className="chart-wrap sm">
              {!cats ? (
                <p className="muted">Loading…</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={genreCcuChart}
                    margin={{ left: 0, right: 8, top: 8, bottom: 4 }}
                  >
                    <CartesianGrid stroke={CHART.grid} strokeDasharray="2 4" />
                    <XAxis
                      dataKey="name"
                      tick={{ fill: CHART.tick, fontSize: 9 }}
                      interval={0}
                      angle={-25}
                      textAnchor="end"
                      height={48}
                    />
                    <YAxis tick={{ fill: CHART.tick, fontSize: 10 }} />
                    <Tooltip
                      contentStyle={tipStyle}
                      formatter={(v) => [formatCount(Number(v)), "Avg CCU"]}
                    />
                    <Bar dataKey="avg_ccu" fill={CHART.white} name="Avg CCU" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>

        {sparkDaily.length > 0 && (
          <div className="chart-box spark">
            <h3 className="chart-title">Reviews — last 21 days</h3>
            <div className="chart-wrap xs">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={sparkDaily}
                  margin={{ left: 0, right: 8, top: 4, bottom: 0 }}
                >
                  <CartesianGrid stroke={CHART.grid} strokeDasharray="2 4" />
                  <XAxis
                    dataKey="day"
                    tick={{ fill: CHART.tick, fontSize: 9 }}
                    hide={sparkDaily.length > 14}
                  />
                  <YAxis tick={{ fill: CHART.tick, fontSize: 9 }} width={36} />
                  <Tooltip contentStyle={tipStyle} />
                  <Area
                    type="monotone"
                    dataKey="positive"
                    stroke={CHART.accent}
                    fill={CHART.accent}
                    fillOpacity={0.25}
                    strokeWidth={1.5}
                    name="Positive"
                  />
                  <Area
                    type="monotone"
                    dataKey="negative"
                    stroke={CHART.gray}
                    fill={CHART.gray}
                    fillOpacity={0.2}
                    strokeWidth={1.5}
                    name="Negative"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      <div className="panel framed">
        <div className="panel-head">
          <h2>Top 10 by genre</h2>
          <span className="status">
            SteamSpy genres + niche tags · ranked by players online
          </span>
        </div>
        {cats?.error && <p className="error">{cats.error}</p>}
        {!cats && <p className="muted">Loading categories…</p>}
        {cats && !cats.error && (
          <div className="cat-grid">
            {(cats.categories ?? []).map((c) => (
              <CategoryCard
                key={c.tag_id}
                title={c.tag_name}
                meta={formatCatMeta(c.num_games, c.avg_ccu)}
                games={cats.byTag[c.tag_name] ?? []}
              />
            ))}
          </div>
        )}
      </div>

      <div className="panel framed">
        <div className="panel-head">
          <h2>Top 10 free games</h2>
          <span className="status">
            {formatCount(freeN)} free titles in catalog
          </span>
        </div>
        {!cats ? (
          <p className="muted">Loading free titles…</p>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th className="num">#</th>
                <th>Game</th>
                <th className="num">Players online</th>
                <th className="num">Owners</th>
              </tr>
            </thead>
            <tbody>
              {topFree.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    No free titles ranked.
                  </td>
                </tr>
              )}
              {topFree.map((g) => (
                <tr key={g.app_id}>
                  <td className={`num ${g.rank === 1 ? "rank-cell top" : "rank-cell"}`}>
                    {g.rank}
                  </td>
                  <td>
                    <span className="game-cell">
                      <Link href={`/game/${g.app_id}`} className="game-link">
                        {g.name}
                      </Link>
                      <FreeTag />
                    </span>
                  </td>
                  <td className="num">{formatCount(g.concurrent_players)}</td>
                  <td className="num owners">
                    {formatOwners(g.owners_estimate)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="grid-2">
        <div className="panel framed">
          <div className="panel-head">
            <h2>Top games by players</h2>
            <span className="status">Highest concurrent players</span>
          </div>
          <table className="data">
            <thead>
              <tr>
                <th>Game</th>
                <th className="num">CCU</th>
                <th className="num">Owners</th>
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
              {(data?.topGames ?? []).map((g) => (
                <tr key={g.app_id}>
                  <td>
                    <span className="game-cell">
                      <Link href={`/game/${g.app_id}`} className="game-link">
                        {g.name}
                      </Link>
                      {g.is_free ? <FreeTag /> : null}
                    </span>
                  </td>
                  <td className="num">{formatCount(g.concurrent_players)}</td>
                  <td className="num owners">
                    {formatOwners(g.owners_estimate)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="panel framed">
          <div className="panel-head">
            <h2>Busy niches</h2>
            <span className="status">High players relative to supply</span>
          </div>
          <table className="data">
            <thead>
              <tr>
                <th>Tag</th>
                <th className="num">Games</th>
                <th className="num">Demand/supply</th>
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
              {(data?.tagGaps ?? []).map((t) => (
                <tr key={t.tag_name}>
                  <td>{t.tag_name}</td>
                  <td className="num">{formatCount(t.num_games)}</td>
                  <td className="num">{t.ratio}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
