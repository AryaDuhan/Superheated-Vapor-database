import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import {
  isGameRelevantTagSql,
  isRealGameSql,
  NON_GAME_APP_IDS,
  nonGameTagsLower,
  toolTagsLower,
} from "@/lib/gameFilters";
import { FREE_DEFINITION, IS_FREE_SQL } from "@/lib/isFree";

export const runtime = "nodejs";

const OFFICIAL_MAJOR_GENRES = [
  "Action",
  "Adventure",
  "RPG",
  "Strategy",
  "Simulation",
  "Indie",
  "Casual",
  "Sports",
  "Racing",
] as const;

/** Niches tracked as Steam tags (not SteamSpy store genres). */
const NICHE_MAJOR_GENRES = [
  "Horror",
  "Shooter",
  "Multiplayer",
  "Survival",
  "Puzzle",
  "Platformer",
] as const;

const MAJOR_GENRES = [...OFFICIAL_MAJOR_GENRES, ...NICHE_MAJOR_GENRES] as const;

type GameRow = {
  app_id: number;
  name: string;
  concurrent_players: number;
  owners_estimate: string | null;
  base_price_usd: string | null;
  current_price: string | null;
  is_free?: boolean;
};

function pct(part: number, whole: number): number {
  if (!whole) return 0;
  return Math.round((10000 * part) / whole) / 100;
}

function num(v: string | number | null | undefined): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function mapGame(g: GameRow) {
  return {
    app_id: g.app_id,
    name: g.name,
    concurrent_players: num(g.concurrent_players),
    owners_estimate: g.owners_estimate ?? "",
    base_price_usd: g.base_price_usd != null ? num(g.base_price_usd) : null,
    current_price: g.current_price != null ? num(g.current_price) : null,
    is_free: g.is_free != null ? !!g.is_free : undefined,
  };
}

export async function GET() {
  try {
    const genreList = MAJOR_GENRES.map((g) => g.toLowerCase());
    const denyToolTags = toolTagsLower();
    const denyNicheTags = nonGameTagsLower();
    const denyAppIds = [...NON_GAME_APP_IDS];
    const realGameP12 = isRealGameSql({
      toolTagsParam: "$1",
      appIdsParam: "$2",
    });
    // Genres query: $1 = genre list, $2/$3 = filters
    const realGameP23 = isRealGameSql({
      toolTagsParam: "$2",
      appIdsParam: "$3",
    });

    const [
      totals,
      topFree,
      topPaid,
      genres,
      sentiment,
      topRecommended,
      priceBuckets,
      ownersBands,
      playtime,
      reviewsOverTime,
      topDevelopers,
      tagGaps,
      priceVsCcu,
      coTags,
    ] = await Promise.all([
      query<{
        free_games: string;
        paid_games: string;
        free_ccu: string;
        paid_ccu: string;
        free_with_ccu: string;
        paid_with_ccu: string;
      }>(`
        WITH latest_ccu AS (
          SELECT DISTINCT ON (app_id)
            app_id, concurrent_players
          FROM player_counts
          ORDER BY app_id, snapshot_time DESC
        ),
        classified AS (
          SELECT
            g.app_id,
            (${IS_FREE_SQL}) AS is_free,
            COALESCE(lc.concurrent_players, 0) AS ccu
          FROM games g
          LEFT JOIN latest_ccu lc ON lc.app_id = g.app_id
        )
        SELECT
          COUNT(*) FILTER (WHERE is_free)::text AS free_games,
          COUNT(*) FILTER (WHERE NOT is_free)::text AS paid_games,
          COALESCE(SUM(ccu) FILTER (WHERE is_free), 0)::text AS free_ccu,
          COALESCE(SUM(ccu) FILTER (WHERE NOT is_free), 0)::text AS paid_ccu,
          COUNT(*) FILTER (WHERE is_free AND ccu > 0)::text AS free_with_ccu,
          COUNT(*) FILTER (WHERE NOT is_free AND ccu > 0)::text AS paid_with_ccu
        FROM classified
      `).then((r) => r[0]),

      query<GameRow>(
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
        )
        SELECT
          g.app_id,
          g.name,
          lc.concurrent_players,
          lc.owners_estimate,
          g.base_price_usd::text AS base_price_usd,
          cu.price::text AS current_price,
          TRUE AS is_free
        FROM latest_ccu lc
        JOIN games g ON g.app_id = lc.app_id
        LEFT JOIN current_usd cu ON cu.app_id = g.app_id
        WHERE ${IS_FREE_SQL}
          AND ${realGameP12}
        ORDER BY lc.concurrent_players DESC NULLS LAST
        LIMIT 12
        `,
        [denyToolTags, denyAppIds],
      ),

      query<GameRow>(
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
        )
        SELECT
          g.app_id,
          g.name,
          lc.concurrent_players,
          lc.owners_estimate,
          g.base_price_usd::text AS base_price_usd,
          cu.price::text AS current_price,
          FALSE AS is_free
        FROM latest_ccu lc
        JOIN games g ON g.app_id = lc.app_id
        LEFT JOIN current_usd cu ON cu.app_id = g.app_id
        WHERE NOT (${IS_FREE_SQL})
          AND ${realGameP12}
        ORDER BY lc.concurrent_players DESC NULLS LAST
        LIMIT 12
        `,
        [denyToolTags, denyAppIds],
      ),

      query<{
        tag_name: string;
        game_count: string;
        free_games: string;
        paid_games: string;
        total_ccu: string;
        avg_ccu: string;
      }>(
        `
        WITH latest_ccu AS (
          SELECT DISTINCT ON (app_id)
            app_id, concurrent_players
          FROM player_counts
          ORDER BY app_id, snapshot_time DESC
        ),
        tagged AS (
          SELECT DISTINCT ON (label, app_id)
            label AS tag_name,
            app_id,
            is_free,
            ccu
          FROM (
            SELECT
              gen.genre_name AS label,
              g.app_id,
              (${IS_FREE_SQL}) AS is_free,
              COALESCE(lc.concurrent_players, 0) AS ccu
            FROM genres gen
            JOIN game_genres gg ON gg.genre_id = gen.genre_id
            JOIN games g ON g.app_id = gg.app_id
            LEFT JOIN latest_ccu lc ON lc.app_id = g.app_id
            WHERE LOWER(gen.genre_name) = ANY($1::text[])
              AND ${realGameP23}
            UNION ALL
            SELECT
              t.tag_name AS label,
              g.app_id,
              (${IS_FREE_SQL}) AS is_free,
              COALESCE(lc.concurrent_players, 0) AS ccu
            FROM tags t
            JOIN game_tags gt ON gt.tag_id = t.tag_id
            JOIN games g ON g.app_id = gt.app_id
            LEFT JOIN latest_ccu lc ON lc.app_id = g.app_id
            WHERE LOWER(t.tag_name) = ANY($4::text[])
              AND ${realGameP23}
          ) u
          ORDER BY label, app_id
        )
        SELECT
          tag_name,
          COUNT(*)::text AS game_count,
          COUNT(*) FILTER (WHERE is_free)::text AS free_games,
          COUNT(*) FILTER (WHERE NOT is_free)::text AS paid_games,
          COALESCE(SUM(ccu), 0)::text AS total_ccu,
          ROUND(AVG(ccu), 1)::text AS avg_ccu
        FROM tagged
        GROUP BY tag_name
        ORDER BY SUM(ccu) DESC NULLS LAST
        LIMIT 12
        `,
        [
          OFFICIAL_MAJOR_GENRES.map((g) => g.toLowerCase()),
          denyToolTags,
          denyAppIds,
          NICHE_MAJOR_GENRES.map((g) => g.toLowerCase()),
        ],
      ),

      query<{
        pos: string;
        neg: string;
        free_pos: string;
        free_neg: string;
        paid_pos: string;
        paid_neg: string;
      }>(`
        SELECT
          COUNT(*) FILTER (WHERE r.is_positive)::text AS pos,
          COUNT(*) FILTER (WHERE NOT r.is_positive)::text AS neg,
          COUNT(*) FILTER (WHERE r.is_positive AND ${IS_FREE_SQL})::text AS free_pos,
          COUNT(*) FILTER (WHERE NOT r.is_positive AND ${IS_FREE_SQL})::text AS free_neg,
          COUNT(*) FILTER (WHERE r.is_positive AND NOT (${IS_FREE_SQL}))::text AS paid_pos,
          COUNT(*) FILTER (WHERE NOT r.is_positive AND NOT (${IS_FREE_SQL}))::text AS paid_neg
        FROM reviews r
        JOIN games g ON g.app_id = r.app_id
      `).then((r) => r[0]),

      query<{
        app_id: number;
        name: string;
        review_count: string;
        positive: string;
        recommend_pct: string;
        is_free: boolean;
      }>(`
        SELECT
          g.app_id,
          g.name,
          COUNT(*)::text AS review_count,
          COUNT(*) FILTER (WHERE r.is_positive)::text AS positive,
          ROUND(
            100.0 * COUNT(*) FILTER (WHERE r.is_positive) / NULLIF(COUNT(*), 0),
            1
          )::text AS recommend_pct,
          (${IS_FREE_SQL}) AS is_free
        FROM reviews r
        JOIN games g ON g.app_id = r.app_id
        GROUP BY g.app_id, g.name, g.base_price_usd
        HAVING COUNT(*) >= 50
        ORDER BY
          (COUNT(*) FILTER (WHERE r.is_positive)::numeric / NULLIF(COUNT(*), 0)) DESC,
          COUNT(*) DESC
        LIMIT 10
      `),

      query<{
        bucket: string;
        sort_key: number;
        game_count: string;
        avg_ccu: string;
      }>(`
        WITH latest_ccu AS (
          SELECT DISTINCT ON (app_id)
            app_id, concurrent_players
          FROM player_counts
          ORDER BY app_id, snapshot_time DESC
        ),
        current_usd AS (
          SELECT app_id, price
          FROM price_history
          WHERE is_current AND currency_code = 'USD'
        ),
        priced AS (
          SELECT
            g.app_id,
            COALESCE(cu.price, g.base_price_usd) AS list_price,
            COALESCE(lc.concurrent_players, 0) AS ccu
          FROM games g
          LEFT JOIN current_usd cu ON cu.app_id = g.app_id
          LEFT JOIN latest_ccu lc ON lc.app_id = g.app_id
          WHERE NOT (${IS_FREE_SQL})
            AND COALESCE(cu.price, g.base_price_usd) IS NOT NULL
            AND COALESCE(cu.price, g.base_price_usd) > 0
        ),
        bucketed AS (
          SELECT
            CASE
              WHEN list_price < 5 THEN '$0–5'
              WHEN list_price < 10 THEN '$5–10'
              WHEN list_price < 20 THEN '$10–20'
              WHEN list_price < 40 THEN '$20–40'
              WHEN list_price < 60 THEN '$40–60'
              ELSE '$60+'
            END AS bucket,
            CASE
              WHEN list_price < 5 THEN 1
              WHEN list_price < 10 THEN 2
              WHEN list_price < 20 THEN 3
              WHEN list_price < 40 THEN 4
              WHEN list_price < 60 THEN 5
              ELSE 6
            END AS sort_key,
            ccu
          FROM priced
        )
        SELECT
          bucket,
          MIN(sort_key) AS sort_key,
          COUNT(*)::text AS game_count,
          ROUND(AVG(ccu), 1)::text AS avg_ccu
        FROM bucketed
        GROUP BY bucket
        ORDER BY MIN(sort_key)
      `),

      query<{
        band: string;
        game_count: string;
        total_ccu: string;
      }>(`
        WITH latest_ccu AS (
          SELECT DISTINCT ON (app_id)
            app_id, concurrent_players, owners_estimate
          FROM player_counts
          ORDER BY app_id, snapshot_time DESC
        )
        SELECT
          COALESCE(NULLIF(TRIM(lc.owners_estimate), ''), 'Unknown') AS band,
          COUNT(*)::text AS game_count,
          COALESCE(SUM(lc.concurrent_players), 0)::text AS total_ccu
        FROM latest_ccu lc
        WHERE lc.owners_estimate IS NOT NULL
          AND TRIM(lc.owners_estimate) <> ''
          AND lc.owners_estimate <> '0'
        GROUP BY COALESCE(NULLIF(TRIM(lc.owners_estimate), ''), 'Unknown')
        ORDER BY COUNT(*) DESC
        LIMIT 12
      `),

      query<{
        free_avg_hours: string;
        paid_avg_hours: string;
        free_reviews: string;
        paid_reviews: string;
      }>(`
        SELECT
          ROUND(AVG(r.playtime_at_review) FILTER (
            WHERE ${IS_FREE_SQL} AND r.playtime_at_review IS NOT NULL
          ) / 60.0, 1)::text AS free_avg_hours,
          ROUND(AVG(r.playtime_at_review) FILTER (
            WHERE NOT (${IS_FREE_SQL}) AND r.playtime_at_review IS NOT NULL
          ) / 60.0, 1)::text AS paid_avg_hours,
          COUNT(*) FILTER (
            WHERE ${IS_FREE_SQL} AND r.playtime_at_review IS NOT NULL
          )::text AS free_reviews,
          COUNT(*) FILTER (
            WHERE NOT (${IS_FREE_SQL}) AND r.playtime_at_review IS NOT NULL
          )::text AS paid_reviews
        FROM reviews r
        JOIN games g ON g.app_id = r.app_id
      `).then((r) => r[0]),

      query<{
        month: string;
        review_count: string;
        positive: string;
        negative: string;
      }>(`
        SELECT
          TO_CHAR(DATE_TRUNC('month', r.review_time), 'YYYY-MM') AS month,
          COUNT(*)::text AS review_count,
          COUNT(*) FILTER (WHERE r.is_positive)::text AS positive,
          COUNT(*) FILTER (WHERE NOT r.is_positive)::text AS negative
        FROM reviews r
        WHERE r.review_time IS NOT NULL
        GROUP BY DATE_TRUNC('month', r.review_time)
        ORDER BY DATE_TRUNC('month', r.review_time)
        LIMIT 48
      `),

      query<{
        name: string;
        game_count: string;
        total_ccu: string;
        avg_ccu: string;
      }>(`
        WITH latest_ccu AS (
          SELECT DISTINCT ON (app_id)
            app_id, concurrent_players
          FROM player_counts
          ORDER BY app_id, snapshot_time DESC
        )
        SELECT
          d.name,
          COUNT(*)::text AS game_count,
          COALESCE(SUM(lc.concurrent_players), 0)::text AS total_ccu,
          ROUND(AVG(COALESCE(lc.concurrent_players, 0)), 1)::text AS avg_ccu
        FROM developers d
        JOIN games g ON g.dev_id = d.dev_id
        LEFT JOIN latest_ccu lc ON lc.app_id = g.app_id
        GROUP BY d.dev_id, d.name
        HAVING COUNT(*) >= 2
        ORDER BY SUM(COALESCE(lc.concurrent_players, 0)) DESC NULLS LAST
        LIMIT 12
      `),

      query<{
        tag_name: string;
        num_games: string;
        avg_players: string;
        ratio: string;
      }>(
        `
        WITH latest_ccu AS (
          SELECT DISTINCT ON (app_id) app_id, concurrent_players
          FROM player_counts
          ORDER BY app_id, snapshot_time DESC
        ),
        real_games AS (
          SELECT g.app_id
          FROM games g
          WHERE ${isRealGameSql({ toolTagsParam: "$1", appIdsParam: "$2" })}
        ),
        tag_supply AS (
          SELECT gt.tag_id, COUNT(*) AS num_games
          FROM game_tags gt
          JOIN real_games rg ON rg.app_id = gt.app_id
          GROUP BY gt.tag_id
        ),
        tag_demand AS (
          SELECT gt.tag_id, AVG(lc.concurrent_players)::numeric AS avg_players
          FROM game_tags gt
          JOIN real_games rg ON rg.app_id = gt.app_id
          JOIN latest_ccu lc ON lc.app_id = gt.app_id
          GROUP BY gt.tag_id
        )
        SELECT t.tag_name, s.num_games::text,
               ROUND(d.avg_players, 1)::text AS avg_players,
               ROUND(d.avg_players / NULLIF(s.num_games, 0), 1)::text AS ratio
        FROM tag_supply s
        JOIN tag_demand d ON d.tag_id = s.tag_id
        JOIN tags t ON t.tag_id = s.tag_id
        WHERE s.num_games BETWEEN 5 AND 100
          AND ${isGameRelevantTagSql("$3")}
        ORDER BY (d.avg_players / NULLIF(s.num_games, 0)) DESC
        LIMIT 10
        `,
        [denyToolTags, denyAppIds, denyNicheTags],
      ),

      query<{
        bucket: string;
        sort_key: number;
        avg_ccu: string;
        game_count: string;
      }>(`
        WITH latest_ccu AS (
          SELECT DISTINCT ON (app_id)
            app_id, concurrent_players
          FROM player_counts
          ORDER BY app_id, snapshot_time DESC
        ),
        current_usd AS (
          SELECT app_id, price
          FROM price_history
          WHERE is_current AND currency_code = 'USD'
        ),
        priced AS (
          SELECT
            COALESCE(cu.price, g.base_price_usd) AS list_price,
            COALESCE(lc.concurrent_players, 0) AS ccu
          FROM games g
          LEFT JOIN current_usd cu ON cu.app_id = g.app_id
          LEFT JOIN latest_ccu lc ON lc.app_id = g.app_id
          WHERE COALESCE(cu.price, g.base_price_usd) IS NOT NULL
            AND COALESCE(cu.price, g.base_price_usd) > 0
        )
        SELECT
          CASE
            WHEN list_price < 5 THEN '$0–5'
            WHEN list_price < 10 THEN '$5–10'
            WHEN list_price < 20 THEN '$10–20'
            WHEN list_price < 40 THEN '$20–40'
            WHEN list_price < 60 THEN '$40–60'
            ELSE '$60+'
          END AS bucket,
          CASE
            WHEN list_price < 5 THEN 1
            WHEN list_price < 10 THEN 2
            WHEN list_price < 20 THEN 3
            WHEN list_price < 40 THEN 4
            WHEN list_price < 60 THEN 5
            ELSE 6
          END AS sort_key,
          ROUND(AVG(ccu), 1)::text AS avg_ccu,
          COUNT(*)::text AS game_count
        FROM priced
        GROUP BY 1, 2
        ORDER BY 2
      `),

      query<{
        tag_a: string;
        tag_b: string;
        co_occurrences: string;
      }>(`
        SELECT t1.tag_name AS tag_a, t2.tag_name AS tag_b, COUNT(*)::text AS co_occurrences
        FROM game_tags gt1
        JOIN game_tags gt2 ON gt1.app_id = gt2.app_id AND gt1.tag_id < gt2.tag_id
        JOIN tags t1 ON gt1.tag_id = t1.tag_id
        JOIN tags t2 ON gt2.tag_id = t2.tag_id
        WHERE LOWER(t1.tag_name) = ANY($1::text[])
          AND LOWER(t2.tag_name) = ANY($1::text[])
        GROUP BY 1, 2
        ORDER BY COUNT(*) DESC
        LIMIT 10
      `, [genreList]),
    ]);

    const freeGames = num(totals.free_games);
    const paidGames = num(totals.paid_games);
    const catalogTotal = freeGames + paidGames;
    const freeCcu = num(totals.free_ccu);
    const paidCcu = num(totals.paid_ccu);
    const ccuTotal = freeCcu + paidCcu;

    const pos = num(sentiment.pos);
    const neg = num(sentiment.neg);
    const reviewTotal = pos + neg;
    const freePos = num(sentiment.free_pos);
    const freeNeg = num(sentiment.free_neg);
    const paidPos = num(sentiment.paid_pos);
    const paidNeg = num(sentiment.paid_neg);
    const freeReviews = freePos + freeNeg;
    const paidReviews = paidPos + paidNeg;

    const genreMapped = genres.map((g) => ({
      tag_name: g.tag_name,
      game_count: num(g.game_count),
      free_games: num(g.free_games),
      paid_games: num(g.paid_games),
      total_ccu: num(g.total_ccu),
      avg_ccu: num(g.avg_ccu),
      ccu_share_pct: pct(num(g.total_ccu), ccuTotal),
    }));

    return NextResponse.json(
      {
        definition: FREE_DEFINITION,
        catalog: {
          free_games: freeGames,
          paid_games: paidGames,
          free_share_pct: pct(freeGames, catalogTotal),
          paid_share_pct: pct(paidGames, catalogTotal),
        },
        ccu: {
          free_ccu: freeCcu,
          paid_ccu: paidCcu,
          free_share_pct: pct(freeCcu, ccuTotal),
          paid_share_pct: pct(paidCcu, ccuTotal),
          free_games_with_ccu: num(totals.free_with_ccu),
          paid_games_with_ccu: num(totals.paid_with_ccu),
        },
        topFree: topFree.map(mapGame),
        topPaid: topPaid.map(mapGame),
        genres: genreMapped,
        sentiment: {
          positive: pos,
          negative: neg,
          positive_pct: pct(pos, reviewTotal),
          free: {
            positive: freePos,
            negative: freeNeg,
            positive_pct: pct(freePos, freeReviews),
            total: freeReviews,
          },
          paid: {
            positive: paidPos,
            negative: paidNeg,
            positive_pct: pct(paidPos, paidReviews),
            total: paidReviews,
          },
        },
        topRecommended: topRecommended.map((g) => ({
          app_id: g.app_id,
          name: g.name,
          review_count: num(g.review_count),
          positive: num(g.positive),
          recommend_pct: num(g.recommend_pct),
          is_free: !!g.is_free,
        })),
        priceBuckets: priceBuckets.map((b) => ({
          bucket: b.bucket,
          game_count: num(b.game_count),
          avg_ccu: num(b.avg_ccu),
        })),
        ownersBands: ownersBands.map((b) => ({
          band: b.band,
          game_count: num(b.game_count),
          total_ccu: num(b.total_ccu),
        })),
        playtime: {
          free_avg_hours: num(playtime.free_avg_hours),
          paid_avg_hours: num(playtime.paid_avg_hours),
          free_reviews: num(playtime.free_reviews),
          paid_reviews: num(playtime.paid_reviews),
          note: "Average hours played when the review was written. This warehouse has no purchase or IAP spend tables.",
        },
        reviewsOverTime: reviewsOverTime.map((r) => ({
          month: r.month,
          review_count: num(r.review_count),
          positive: num(r.positive),
          negative: num(r.negative),
        })),
        topDevelopers: topDevelopers.map((d) => ({
          name: d.name,
          game_count: num(d.game_count),
          total_ccu: num(d.total_ccu),
          avg_ccu: num(d.avg_ccu),
        })),
        tagGaps: tagGaps.map((t) => ({
          tag_name: t.tag_name,
          num_games: num(t.num_games),
          avg_players: num(t.avg_players),
          ratio: num(t.ratio),
        })),
        priceVsCcu: priceVsCcu.map((b) => ({
          bucket: b.bucket,
          avg_ccu: num(b.avg_ccu),
          game_count: num(b.game_count),
        })),
        tagCooccurrence: coTags.map((p) => ({
          tag_a: p.tag_a,
          tag_b: p.tag_b,
          co_occurrences: num(p.co_occurrences),
        })),
        monetization: {
          spend_data_available: false,
          unavailable:
            "No purchase, DLC, or microtransaction spend tables in the warehouse — dollar spend / IAP revenue cannot be reported.",
        },
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
        },
      },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
