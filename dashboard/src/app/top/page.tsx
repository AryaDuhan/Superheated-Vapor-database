"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FilterSelect } from "@/components/FilterSelect";
import { cachedGet, peekCache } from "@/lib/apiCache";
import { formatCount, formatOwners, formatStorePrice } from "@/lib/format";

type GameRow = {
  rank: number;
  app_id: number;
  name: string;
  concurrent_players: number;
  owners_estimate: string;
  price: number | null;
  price_inr: number | null;
  is_free: boolean;
  review_count: number;
  recommend_pct: number | null;
  avg_playtime_hours: number | null;
};

type Payload = {
  definition?: string;
  filters?: {
    category: string;
    price: string;
    sort: string;
    minCcu: number;
    limit: number;
    categories: string[];
    prices: string[];
    sorts: string[];
    limits: number[];
    min_reviews_for_recommend: number;
  };
  games?: GameRow[];
  error?: string;
};

const CATEGORY_OPTS = [
  "All",
  "Horror",
  "Indie",
  "Adventure",
  "Metroidvania",
  "Action",
  "RPG",
  "Strategy",
  "Simulation",
  "Casual",
  "Puzzle",
  "Platformer",
  "Survival",
  "Roguelike",
  "Multiplayer",
  "Sports",
  "Racing",
  "Shooter",
  "FPS",
  "Open World",
  "Sandbox",
  "JRPG",
  "MMORPG",
  "Visual Novel",
  "Fighting",
  "Stealth",
  "Action RPG",
  "Souls-like",
  "Survival Horror",
  "RTS",
  "Grand Strategy",
  "Turn-Based Strategy",
  "MOBA",
  "Battle Royale",
  "Hack and Slash",
  "Point & Click",
  "Dungeon Crawler",
  "Tower Defense",
  "Card Game",
  "City Builder",
  "Management",
  "Action-Adventure",
].map((c) => ({ value: c, label: c }));

const PRICE_OPTS: { value: string; label: string }[] = [
  { value: "all", label: "All prices" },
  { value: "free", label: "Free ($0)" },
  { value: "paid", label: "Paid" },
  { value: "under5", label: "Under $5" },
  { value: "5to15", label: "$5–$15" },
  { value: "15to30", label: "$15–$30" },
  { value: "over30", label: "$30+" },
];

const SORT_OPTS: { value: string; label: string }[] = [
  { value: "ccu", label: "Players online (CCU)" },
  { value: "owners", label: "Owners estimate" },
  { value: "recommend", label: "Most recommended" },
  { value: "least_recommend", label: "Least recommended" },
  { value: "reviews", label: "Review count" },
  { value: "playtime", label: "Playtime at review" },
  { value: "name", label: "Name" },
];

const MIN_CCU_OPTS: { value: string; label: string }[] = [
  { value: "0", label: "Any" },
  { value: "10", label: "10+" },
  { value: "100", label: "100+" },
  { value: "1000", label: "1k+" },
  { value: "10000", label: "10k+" },
];

const LIMIT_OPTS: { value: string; label: string }[] = [
  { value: "25", label: "25" },
  { value: "50", label: "50" },
  { value: "100", label: "100" },
];

const DEFAULT_QUERY = "/api/top?sort=ccu&limit=50&price=all&category=All&minCcu=0";

function buildUrl(opts: {
  category: string;
  price: string;
  sort: string;
  minCcu: number;
  limit: number;
}): string {
  const q = new URLSearchParams({
    category: opts.category,
    price: opts.price,
    sort: opts.sort,
    minCcu: String(opts.minCcu),
    limit: String(opts.limit),
  });
  return `/api/top?${q.toString()}`;
}

function FreeTag() {
  return <span className="free-tag">FREE</span>;
}

export default function TopPage() {
  const [category, setCategory] = useState<string>("All");
  const [price, setPrice] = useState("all");
  const [sort, setSort] = useState("ccu");
  const [minCcu, setMinCcu] = useState(0);
  const [limit, setLimit] = useState(50);

  const url = useMemo(
    () => buildUrl({ category, price, sort, minCcu, limit }),
    [category, price, sort, minCcu, limit],
  );

  const [data, setData] = useState<Payload | null>(() =>
    peekCache(DEFAULT_QUERY) ?? peekCache(url),
  );
  const [loading, setLoading] = useState(!peekCache(url) && !peekCache(DEFAULT_QUERY));

  const load = useCallback((target: string) => {
    setLoading(true);
    cachedGet<Payload>(target)
      .then((payload) => {
        setData(payload);
        setLoading(false);
      })
      .catch((e) => {
        setData({ error: String(e) });
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    const cached = peekCache<Payload>(url);
    if (cached) {
      setData(cached);
      setLoading(false);
    }
    load(url);
  }, [url, load]);

  const games = data?.games ?? [];
  const statusLabel = loading
    ? "Loading"
    : data?.error
      ? "Error"
      : "Ok";

  return (
    <>
      <section className="hero framed">
        <p className="eyebrow">Top</p>
        <h1>Ranked games</h1>
        <p>
          Filter and sort by players online, estimated owners, or how often
          reviews recommend the game.
        </p>
        <p className="hero-meta">Status: {statusLabel}</p>
      </section>

      <div className="panel framed">
        <div className="panel-head">
          <h2>Filters</h2>
          <span className="status">
            {loading ? "Loading" : `${games.length} results`}
          </span>
        </div>

        <div className="filter-row">
          <label className="filter-field">
            <span className="filter-label">Category</span>
            <FilterSelect
              value={category}
              options={CATEGORY_OPTS}
              onChange={setCategory}
              aria-label="Category"
            />
          </label>

          <label className="filter-field">
            <span className="filter-label">Price</span>
            <FilterSelect
              value={price}
              options={PRICE_OPTS}
              onChange={setPrice}
              aria-label="Price"
            />
          </label>

          <label className="filter-field">
            <span className="filter-label">Sort by</span>
            <FilterSelect
              value={sort}
              options={SORT_OPTS}
              onChange={setSort}
              aria-label="Sort by"
            />
          </label>

          <label className="filter-field">
            <span className="filter-label">Min CCU</span>
            <FilterSelect
              value={String(minCcu)}
              options={MIN_CCU_OPTS}
              onChange={(v) => setMinCcu(Number(v))}
              aria-label="Min CCU"
            />
          </label>

          <label className="filter-field">
            <span className="filter-label">Limit</span>
            <FilterSelect
              value={String(limit)}
              options={LIMIT_OPTS}
              onChange={(v) => setLimit(Number(v))}
              aria-label="Limit"
            />
          </label>
        </div>

        <p className="filter-help">
          {data?.definition ??
            "Players online = CCU. Owners = estimate bands (not purchases). Free = price $0 only."}
        </p>
      </div>

      {data?.error && <p className="error">{data.error}</p>}

      <div className="panel framed">
        <div className="panel-head">
          <h2>Results</h2>
          <span className="status">
            Sort:{" "}
            {SORT_OPTS.find((o) => o.value === sort)?.label ?? sort}
          </span>
        </div>

        <table className="data">
          <thead>
            <tr>
              <th className="num">#</th>
              <th>Game</th>
              <th className="num">CCU</th>
              <th className="num">Owners est.</th>
              <th className="num">Price</th>
              <th className="num">Rec %</th>
              <th className="num">Reviews</th>
              <th className="num">Hrs @ rev</th>
            </tr>
          </thead>
          <tbody>
            {loading && games.length === 0 && (
              <tr>
                <td colSpan={8} className="muted">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && games.length === 0 && (
              <tr>
                <td colSpan={8} className="muted">
                  No games match these filters.
                </td>
              </tr>
            )}
            {games.map((g) => (
              <tr key={g.app_id}>
                <td
                  className={`num ${g.rank === 1 ? "rank-cell top" : "rank-cell"}`}
                >
                  {g.rank}
                </td>
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
                <td className="num">
                  {formatStorePrice({
                    usd: g.price,
                    inr: g.price_inr,
                    isFree: g.is_free,
                    zeroUsdAs: "$0",
                  })}
                </td>
                <td className="num">
                  {g.recommend_pct != null
                    ? `${g.recommend_pct.toFixed(1)}%`
                    : "—"}
                </td>
                <td className="num">{formatCount(g.review_count)}</td>
                <td className="num">
                  {g.avg_playtime_hours != null
                    ? g.avg_playtime_hours.toFixed(1)
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
