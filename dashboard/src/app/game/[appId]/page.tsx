"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
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
import { formatCount, formatOwners, formatStorePrice, formatUsd, formatInr } from "@/lib/format";

type Payload = {
  game: {
    app_id: number;
    name: string;
    description: string | null;
    release_date: string | null;
    developer: string | null;
    base_price_usd: number | null;
    current_price: number | null;
    current_price_inr: number | null;
    discount_pct: number | null;
    is_free: boolean;
    concurrent_players: number;
    owners_estimate: string;
    snapshot_time: string | null;
  };
  reviews: {
    positive: number;
    negative: number;
    total: number;
    pos_pct: number | null;
    avg_playtime_min: number | null;
    median_playtime_min: number | null;
  };
  tags: string[];
  ccuHistory: { t: string; ccu: number }[];
  topReviews: {
    review_id: string;
    review_text: string;
    is_positive: boolean;
    playtime_at_review: number | null;
    review_time: string | null;
    lexicon: { label: string; score: number };
  }[];
  unavailable: {
    money_spent: string;
    hours_played: string;
    publisher: string;
    inr_price?: string | null;
  };
  error?: string;
};

const CHART = {
  grid: "rgba(255,255,255,0.12)",
  tick: "#7a7a7a",
  tipBg: "#000",
  tipBorder: "rgba(255,255,255,0.35)",
  tipColor: "#d4d4d4",
  accent: "#ff5c1a",
  ok: "#3ecf7a",
  bad: "#e05555",
  gray: "#666666",
};

function minutesToHoursLabel(min: number | null) {
  if (min == null || !Number.isFinite(min)) return "—";
  const h = min / 60;
  if (h >= 10) return `${Math.round(h)}h`;
  if (h >= 1) return `${(Math.round(h * 10) / 10).toFixed(1)}h`;
  return `${Math.round(min)}m`;
}

export default function GameReportPage() {
  const params = useParams();
  const appId = String(params?.appId ?? "");
  const url = appId ? `/api/game/${appId}` : "";

  const [data, setData] = useState<Payload | null>(() =>
    url ? peekCache(url) : null,
  );

  useEffect(() => {
    if (!url) return;
    cachedGet<Payload>(url)
      .then(setData)
      .catch((e) => setData({ error: String(e) } as Payload));
  }, [url]);

  const loading = !data;
  const g = data?.game;
  const r = data?.reviews;

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

  const sentimentBars = useMemo(
    () => [
      { name: "Positive", count: r?.positive ?? 0, fill: CHART.ok },
      { name: "Negative", count: r?.negative ?? 0, fill: CHART.bad },
    ],
    [r?.positive, r?.negative],
  );

  const ccuSpark = useMemo(
    () =>
      (data?.ccuHistory ?? []).map((p) => ({
        day: (p.t ?? "").slice(0, 10),
        ccu: p.ccu,
      })),
    [data?.ccuHistory],
  );

  return (
    <>
      <section className="hero framed">
        <p className="hero-meta">
          <Link href="/" className="game-link">
            ← Store
          </Link>
          {" · "}
          App {appId || "—"}
        </p>
        <h1>
          {loading
            ? "Loading game…"
            : data?.error
              ? "Game not found"
              : (g?.name ?? "Unknown")}
        </h1>
        <p>
          {g?.developer
            ? `Developer ${g.developer}`
            : "Detailed concurrent, ownership, price, and review report."}
          {g?.release_date ? ` · Released ${g.release_date}` : ""}
          {g ? ` · ${g.is_free ? "Free" : "Paid"}` : ""}
        </p>
        <p className="hero-meta">
          Status:{" "}
          <span className={loading ? "" : data?.error ? "bad" : "ok"}>
            {loading ? "Loading" : data?.error ? "Error" : "Ok"}
          </span>
        </p>
      </section>

      {data?.error && <p className="error">{data.error}</p>}

      <div className="stats">
        <div className="stat framed">
          <div className="label">Players online</div>
          <div className="sublabel">Latest concurrent</div>
          <div className="value accent">
            {loading ? "…" : formatCount(g?.concurrent_players)}
          </div>
        </div>
        <div className="stat framed">
          <div className="label">Owners</div>
          <div className="sublabel">Estimate band</div>
          <div className="value">
            {loading ? "…" : formatOwners(g?.owners_estimate)}
          </div>
        </div>
        <div className="stat framed">
          <div className="label">Hours at review</div>
          <div className="sublabel">Average / median</div>
          <div className="value">
            {loading
              ? "…"
              : `${minutesToHoursLabel(r?.avg_playtime_min ?? null)} / ${minutesToHoursLabel(r?.median_playtime_min ?? null)}`}
          </div>
        </div>
        <div className="stat framed">
          <div className="label">Price</div>
          <div className="sublabel">
            {g?.is_free
              ? "Free"
              : g?.current_price_inr != null
                ? "USD · INR"
                : "List price (USD)"}
          </div>
          <div className="value">
            {loading
              ? "…"
              : formatStorePrice({
                  usd: g?.current_price ?? g?.base_price_usd ?? null,
                  inr: g?.current_price_inr ?? null,
                  isFree: g?.is_free,
                })}
          </div>
        </div>
      </div>

      <div className="stats">
        <div className="stat framed">
          <div className="label">Recommend rate</div>
          <div className="sublabel">From reviews</div>
          <div className="value">
            {loading
              ? "…"
              : r?.pos_pct != null
                ? `${r.pos_pct}%`
                : "—"}
          </div>
        </div>
        <div className="stat framed">
          <div className="label">Positive</div>
          <div className="sublabel">Count</div>
          <div className="value">
            {loading ? "…" : formatCount(r?.positive)}
          </div>
        </div>
        <div className="stat framed">
          <div className="label">Negative</div>
          <div className="sublabel">Count</div>
          <div className="value">
            {loading ? "…" : formatCount(r?.negative)}
          </div>
        </div>
        <div className="stat framed">
          <div className="label">Money spent</div>
          <div className="sublabel">Not in warehouse</div>
          <div className="value muted-value">N/A</div>
        </div>
      </div>

      <div className="grid-2">
        <div className="panel framed">
          <div className="panel-head">
            <h2>Review split</h2>
            <span className="status">
              {formatCount(r?.total)} reviews
            </span>
          </div>
          <div className="chart-wrap sm">
            {loading ? (
              <p className="muted">Loading…</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={sentimentBars}
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
                  <Bar dataKey="count">
                    {sentimentBars.map((d) => (
                      <Cell key={d.name} fill={d.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="panel framed">
          <div className="panel-head">
            <h2>Players over time</h2>
            <span className="status">
              {ccuSpark.length ? `${ccuSpark.length} snapshots` : "No data"}
            </span>
          </div>
          <div className="chart-wrap sm">
            {loading ? (
              <p className="muted">Loading…</p>
            ) : ccuSpark.length === 0 ? (
              <p className="muted">No player-count history for this game.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={ccuSpark}
                  margin={{ left: 0, right: 8, top: 4, bottom: 0 }}
                >
                  <CartesianGrid stroke={CHART.grid} strokeDasharray="2 4" />
                  <XAxis
                    dataKey="day"
                    tick={{ fill: CHART.tick, fontSize: 9 }}
                  />
                  <YAxis tick={{ fill: CHART.tick, fontSize: 9 }} width={40} />
                  <Tooltip
                    contentStyle={tipStyle}
                    formatter={(v) => [formatCount(Number(v)), "Players"]}
                  />
                  <Area
                    type="monotone"
                    dataKey="ccu"
                    stroke={CHART.accent}
                    fill={CHART.accent}
                    fillOpacity={0.28}
                    strokeWidth={1.5}
                    name="Players"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      <div className="panel framed">
        <div className="panel-head">
          <h2>Details & tags</h2>
          <span className="status">
            {g?.is_free ? "Free" : "Paid"} · App {g?.app_id ?? "—"}
          </span>
        </div>
        <dl className="meta-grid">
          <div>
            <dt>Developer</dt>
            <dd>{g?.developer ?? "—"}</dd>
          </div>
          <div>
            <dt>Publisher</dt>
            <dd className="muted">N/A</dd>
          </div>
          <div>
            <dt>Release</dt>
            <dd>{g?.release_date ?? "—"}</dd>
          </div>
          <div>
            <dt>List price (USD)</dt>
            <dd>{formatUsd(g?.base_price_usd ?? null)}</dd>
          </div>
          <div>
            <dt>Current price (USD)</dt>
            <dd>{formatUsd(g?.current_price ?? null)}</dd>
          </div>
          <div>
            <dt>Current price (INR)</dt>
            <dd>
              {g?.current_price_inr != null
                ? formatInr(g.current_price_inr)
                : "—"}
            </dd>
          </div>
          <div>
            <dt>Discount</dt>
            <dd>
              {g?.discount_pct != null ? `${g.discount_pct}%` : "—"}
            </dd>
          </div>
        </dl>
        <div className="tag-cloud">
          {(data?.tags ?? []).length === 0 && !loading && (
            <span className="muted">No tags linked.</span>
          )}
          {(data?.tags ?? []).map((t) => (
            <span key={t} className="pill">
              {t}
            </span>
          ))}
        </div>
        {g?.description && (
          <p className="desc-block">{g.description}</p>
        )}
        <p className="muted note-block">
          {data?.unavailable?.hours_played}{" "}
          {data?.unavailable?.money_spent} {data?.unavailable?.publisher}
          {data?.unavailable?.inr_price
            ? ` ${data.unavailable.inr_price}`
            : ""}
        </p>
      </div>

      <div className="panel framed">
        <div className="panel-head">
          <h2>Sample reviews</h2>
          <span className="status">3 positive · 3 negative</span>
        </div>
        {(data?.topReviews ?? []).length === 0 && !loading && (
          <p className="muted">No review texts stored for this game.</p>
        )}
        {(data?.topReviews ?? []).map((rev) => (
          <article key={rev.review_id} className="hit">
            <div className="meta">
              <span className={rev.is_positive ? "pill pos" : "pill neg"}>
                {rev.is_positive ? "Recommended" : "Not Recommended"}
              </span>
              <span className="pill">{rev.lexicon.label}</span>
              {rev.playtime_at_review != null && (
                <span className="muted">
                  {minutesToHoursLabel(rev.playtime_at_review)} at review
                </span>
              )}
              {rev.review_time && (
                <span className="muted">{rev.review_time.slice(0, 10)}</span>
              )}
            </div>
            <p>{rev.review_text}</p>
          </article>
        ))}
      </div>
    </>
  );
}
