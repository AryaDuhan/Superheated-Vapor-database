import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import {
  isRealGameSql,
  NON_GAME_APP_IDS,
  toolTagsLower,
} from "@/lib/gameFilters";

export const runtime = "nodejs";

/** Curated genres for the category filter (Steam tags). */
export const TOP_CATEGORIES = [
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
] as const;

const CATEGORY_ALIASES: Record<string, readonly string[]> = {
  Roguelike: ["Roguelike", "Rogue-like", "Roguelite", "Rogue-lite"],
};

const SORTS = [
  "ccu",
  "owners",
  "recommend",
  "least_recommend",
  "reviews",
  "playtime",
  "name",
] as const;

type SortKey = (typeof SORTS)[number];

const PRICES = [
  "all",
  "free",
  "paid",
  "under5",
  "5to15",
  "15to30",
  "over30",
] as const;

type PriceKey = (typeof PRICES)[number];

const LIMITS = [25, 50, 100] as const;

const HELPER =
  "Players online = latest concurrent players (CCU). Owners = SteamSpy estimate bands (not purchase counts). Recommend % = share of positive reviews. Free = store price is exactly 0 (USD, or INR when USD missing). Price column shows USD and INR when both exist in price_history. Playtime = average hours at review.";

const MIN_REVIEWS_FOR_RECOMMEND = 20;

type Row = {
  app_id: number;
  name: string;
  concurrent_players: number;
  owners_estimate: string | null;
  list_price: string | null;
  list_price_inr: string | null;
  review_count: string;
  recommend_pct: string | null;
  avg_playtime_hours: string | null;
};

function parseSort(raw: string | null): SortKey {
  if (raw && (SORTS as readonly string[]).includes(raw)) return raw as SortKey;
  return "ccu";
}

function parsePrice(raw: string | null): PriceKey {
  if (raw && (PRICES as readonly string[]).includes(raw)) return raw as PriceKey;
  return "all";
}

function parseLimit(raw: string | null): number {
  const n = Number(raw);
  if ((LIMITS as readonly number[]).includes(n)) return n;
  return 50;
}

function parseMinCcu(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.floor(n), 1_000_000);
}

function categoryMatchTags(category: string): string[] | null {
  if (!category || category.toLowerCase() === "all") return null;
  const canonical = TOP_CATEGORIES.find(
    (c) => c.toLowerCase() === category.toLowerCase(),
  );
  if (!canonical) {
    // Allow any Steam tag name the UI passes through
    return [category.toLowerCase()];
  }
  const aliases = CATEGORY_ALIASES[canonical];
  if (aliases) return aliases.map((a) => a.toLowerCase());
  return [canonical.toLowerCase()];
}

function ownersLoSql(alias: string): string {
  return `NULLIF(
    regexp_replace(
      trim(split_part(COALESCE(${alias}.owners_estimate, ''), '..', 1)),
      '[^0-9]',
      '',
      'g'
    ),
    ''
  )::bigint`;
}

function orderClause(sort: SortKey): string {
  switch (sort) {
    case "owners":
      return `owners_lo DESC NULLS LAST, concurrent_players DESC NULLS LAST, name ASC`;
    case "recommend":
      return `recommend_pct DESC NULLS LAST, review_count DESC, name ASC`;
    case "least_recommend":
      return `recommend_pct ASC NULLS LAST, review_count DESC, name ASC`;
    case "reviews":
      return `review_count DESC, concurrent_players DESC NULLS LAST, name ASC`;
    case "playtime":
      return `avg_playtime_hours DESC NULLS LAST, review_count DESC, name ASC`;
    case "name":
      return `name ASC`;
    case "ccu":
    default:
      return `concurrent_players DESC NULLS LAST, name ASC`;
  }
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const category = (sp.get("category") ?? "all").trim() || "all";
    const price = parsePrice(sp.get("price"));
    const sort = parseSort(sp.get("sort"));
    const limit = parseLimit(sp.get("limit"));
    const minCcu = parseMinCcu(sp.get("minCcu"));

    const matchTags = categoryMatchTags(category);
    const params: unknown[] = [];
    const push = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };

    const where: string[] = [];

    // Always exclude software/tools/non-games from ranked lists
    const toolParam = push(toolTagsLower());
    const appIdsParam = push([...NON_GAME_APP_IDS]);
    where.push(
      isRealGameSql({
        toolTagsParam: toolParam,
        appIdsParam,
      }),
    );

    if (matchTags) {
      const p = push(matchTags);
      where.push(`EXISTS (
        SELECT 1
        FROM game_tags gt
        JOIN tags t ON t.tag_id = gt.tag_id
        WHERE gt.app_id = g.app_id
          AND LOWER(t.tag_name) = ANY(${p}::text[])
      )`);
    }

    // Price filters use COALESCE(current USD, base_price_usd).
    // Free = exactly 0 — never F2P tag alone.
    const listPrice = `COALESCE(cu.price, g.base_price_usd)`;
    if (price === "free") {
      where.push(`${listPrice} = 0`);
    } else if (price === "paid") {
      where.push(`${listPrice} > 0`);
    } else if (price === "under5") {
      where.push(`${listPrice} > 0 AND ${listPrice} < 5`);
    } else if (price === "5to15") {
      where.push(`${listPrice} >= 5 AND ${listPrice} < 15`);
    } else if (price === "15to30") {
      where.push(`${listPrice} >= 15 AND ${listPrice} < 30`);
    } else if (price === "over30") {
      where.push(`${listPrice} >= 30`);
    }

    if (minCcu > 0) {
      const p = push(minCcu);
      where.push(`COALESCE(lc.concurrent_players, 0) >= ${p}`);
    }

    if (sort === "recommend" || sort === "least_recommend") {
      where.push(`COALESCE(rs.review_count, 0) >= ${MIN_REVIEWS_FOR_RECOMMEND}`);
    }

    const whereSql = where.length ? `WHERE ${where.join("\n  AND ")}` : "";
    const limitParam = push(limit);

    const rows = await query<Row>(
      `
      WITH latest_ccu AS (
        SELECT DISTINCT ON (app_id)
          app_id, concurrent_players, owners_estimate
        FROM player_counts
        ORDER BY app_id, snapshot_time DESC
      ),
      current_usd AS (
        SELECT app_id, price
        FROM price_history
        WHERE is_current AND currency_code = 'USD'
      ),
      current_inr AS (
        SELECT app_id, price
        FROM price_history
        WHERE is_current AND currency_code = 'INR'
      ),
      review_stats AS (
        SELECT
          app_id,
          COUNT(*)::int AS review_count,
          ROUND(
            100.0 * COUNT(*) FILTER (WHERE is_positive) / NULLIF(COUNT(*), 0),
            1
          ) AS recommend_pct,
          ROUND(AVG(playtime_at_review) FILTER (
            WHERE playtime_at_review IS NOT NULL
          ) / 60.0, 1) AS avg_playtime_hours
        FROM reviews
        GROUP BY app_id
      ),
      base AS (
        SELECT
          g.app_id,
          g.name,
          COALESCE(lc.concurrent_players, 0) AS concurrent_players,
          COALESCE(lc.owners_estimate, '0') AS owners_estimate,
          COALESCE(cu.price, g.base_price_usd) AS list_price,
          ci.price AS list_price_inr,
          ${ownersLoSql("lc")} AS owners_lo,
          COALESCE(rs.review_count, 0) AS review_count,
          rs.recommend_pct,
          rs.avg_playtime_hours
        FROM games g
        LEFT JOIN latest_ccu lc ON lc.app_id = g.app_id
        LEFT JOIN current_usd cu ON cu.app_id = g.app_id
        LEFT JOIN current_inr ci ON ci.app_id = g.app_id
        LEFT JOIN review_stats rs ON rs.app_id = g.app_id
        ${whereSql}
      )
      SELECT
        app_id,
        name,
        concurrent_players,
        owners_estimate,
        list_price::text AS list_price,
        list_price_inr::text AS list_price_inr,
        review_count::text AS review_count,
        recommend_pct::text AS recommend_pct,
        avg_playtime_hours::text AS avg_playtime_hours
      FROM base
      ORDER BY ${orderClause(sort)}
      LIMIT ${limitParam}
      `,
      params,
    );

    const games = rows.map((g, i) => {
      const priceNum =
        g.list_price != null && g.list_price !== ""
          ? Number(g.list_price)
          : null;
      const priceInr =
        g.list_price_inr != null && g.list_price_inr !== ""
          ? Number(g.list_price_inr)
          : null;
      const isFree = priceNum === 0 || (priceNum == null && priceInr === 0);
      return {
        rank: i + 1,
        app_id: g.app_id,
        name: g.name,
        concurrent_players: Number(g.concurrent_players) || 0,
        owners_estimate: g.owners_estimate ?? "0",
        price: priceNum != null && Number.isFinite(priceNum) ? priceNum : null,
        price_inr:
          priceInr != null && Number.isFinite(priceInr) ? priceInr : null,
        is_free: isFree,
        review_count: Number(g.review_count) || 0,
        recommend_pct:
          g.recommend_pct != null && g.recommend_pct !== ""
            ? Number(g.recommend_pct)
            : null,
        avg_playtime_hours:
          g.avg_playtime_hours != null && g.avg_playtime_hours !== ""
            ? Number(g.avg_playtime_hours)
            : null,
      };
    });

    return NextResponse.json(
      {
        definition: HELPER,
        filters: {
          category,
          price,
          sort,
          minCcu,
          limit,
          categories: ["All", ...TOP_CATEGORIES],
          prices: PRICES,
          sorts: SORTS,
          limits: LIMITS,
          min_reviews_for_recommend: MIN_REVIEWS_FOR_RECOMMEND,
        },
        games,
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=45, stale-while-revalidate=90",
        },
      },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
