"use client";

import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cachedGet, peekCache } from "@/lib/apiCache";
import { formatCount } from "@/lib/format";

type Payload = {
  overall: { positive: string; negative: string; total: string };
  byGame: {
    name: string;
    positive: string;
    negative: string;
    total: string;
    pos_pct: string;
  }[];
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
  pos: "#ff5c1a",
  neg: "#666666",
};

function shortTick(name: string, max = 24) {
  if (name.length <= max) return name;
  return `${name.slice(0, max - 1)}…`;
}

type View = "by_game" | "over_time";

export default function SentimentPage() {
  const [data, setData] = useState<Payload | null>(() =>
    peekCache("/api/sentiment"),
  );
  const [view, setView] = useState<View>("by_game");

  useEffect(() => {
    cachedGet<Payload>("/api/sentiment")
      .then(setData)
      .catch((e) => setData({ error: String(e) } as Payload));
  }, []);

  const chart = (data?.byGame ?? []).slice(0, 10).map((g) => ({
    name: shortTick(g.name, 24),
    full: g.name,
    positive: Number(g.positive),
    negative: Number(g.negative),
    pos_pct: Number(g.pos_pct),
  }));

  const daily = (data?.daily ?? []).map((d) => ({
    day: d.day.slice(5),
    positive: Number(d.positive),
    negative: Number(d.negative),
  }));

  const loading = !data;
  const tipStyle = {
    background: CHART.tipBg,
    border: `1px solid ${CHART.tipBorder}`,
    color: CHART.tipColor,
    fontFamily: "var(--font-mono)",
    fontSize: 11,
  };

  return (
    <>
      <section className="hero framed">
        <p className="eyebrow">Community</p>
        <h1>Review ratings</h1>
        <p>
          How often players recommend games — overall and across the reviews we
          store.
        </p>
        <p className="hero-meta">
          Status: {loading ? "Loading" : data?.error ? "Error" : "OK"}
        </p>
      </section>

      {data?.error && <p className="error">{data.error}</p>}

      <div className="stats">
        <div className="stat framed">
          <div className="label">Positive</div>
          <div className="sublabel">Live</div>
          <div className="value">
            {loading ? "…" : formatCount(data?.overall?.positive)}
          </div>
        </div>
        <div className="stat framed">
          <div className="label">Negative</div>
          <div className="sublabel">Live</div>
          <div className="value">
            {loading ? "…" : formatCount(data?.overall?.negative)}
          </div>
        </div>
        <div className="stat framed">
          <div className="label">Total reviews</div>
          <div className="sublabel">With a recommend vote</div>
          <div className="value">
            {loading ? "…" : formatCount(data?.overall?.total)}
          </div>
        </div>
        <div className="stat framed">
          <div className="label">Recommend rate</div>
          <div className="sublabel">Share of reviews</div>
          <div className="value">
            {data?.overall
              ? (
                  (100 * Number(data.overall.positive)) /
                  Math.max(Number(data.overall.total), 1)
                ).toFixed(1)
              : "…"}
            %
          </div>
        </div>
      </div>

      <div className="panel framed">
        <div className="panel-head">
          <h2>
            {view === "by_game"
              ? "Recommended by game"
              : "Signals over time"}
          </h2>
          <span className="status">Community votes</span>
        </div>
        <div className="toggle-row" role="tablist">
          <button
            type="button"
            className={view === "by_game" ? "toggle active" : "toggle"}
            onClick={() => setView("by_game")}
          >
            By game
          </button>
          <button
            type="button"
            className={view === "over_time" ? "toggle active" : "toggle"}
            onClick={() => setView("over_time")}
          >
            Over time
          </button>
        </div>
        <div className={view === "by_game" ? "chart-wrap lg" : "chart-wrap"}>
          {loading ? (
            <p className="muted">Loading chart…</p>
          ) : view === "by_game" ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chart}
                layout="vertical"
                margin={{ left: 8, right: 16, top: 32, bottom: 8 }}
              >
                <CartesianGrid
                  stroke={CHART.grid}
                  strokeDasharray="2 4"
                  horizontal={false}
                />
                <XAxis
                  type="number"
                  tick={{ fill: CHART.label, fontSize: 12 }}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={160}
                  interval={0}
                  tick={{ fill: CHART.label, fontSize: 12 }}
                />
                <Tooltip
                  contentStyle={tipStyle}
                  labelFormatter={(_, payload) =>
                    String(payload?.[0]?.payload?.full ?? "")
                  }
                />
                <Legend
                  verticalAlign="top"
                  align="right"
                  wrapperStyle={{ color: CHART.label, fontSize: 12 }}
                />
                <Bar
                  dataKey="positive"
                  stackId="a"
                  fill={CHART.pos}
                  name="Recommended"
                />
                <Bar
                  dataKey="negative"
                  stackId="a"
                  fill={CHART.neg}
                  name="Not Recommended"
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={daily}
                margin={{ left: 0, right: 8, top: 32, bottom: 8 }}
              >
                <CartesianGrid stroke={CHART.grid} strokeDasharray="2 4" />
                <XAxis
                  dataKey="day"
                  tick={{ fill: CHART.label, fontSize: 12 }}
                />
                <YAxis tick={{ fill: CHART.label, fontSize: 12 }} />
                <Tooltip contentStyle={tipStyle} />
                <Legend
                  verticalAlign="top"
                  align="right"
                  wrapperStyle={{ color: CHART.label, fontSize: 12 }}
                />
                <Line
                  type="monotone"
                  dataKey="positive"
                  stroke={CHART.pos}
                  strokeWidth={1.5}
                  dot={{ r: 2, fill: CHART.pos }}
                  name="Recommended"
                />
                <Line
                  type="monotone"
                  dataKey="negative"
                  stroke={CHART.neg}
                  strokeWidth={1.5}
                  dot={{ r: 2, fill: CHART.neg }}
                  name="Not Recommended"
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </>
  );
}
