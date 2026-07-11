import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { IS_FREE_SQL } from "@/lib/isFree";
import { lexiconSentiment } from "@/lib/sentiment";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ appId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { appId: raw } = await ctx.params;
    const appId = Number(raw);
    if (!Number.isFinite(appId) || appId <= 0) {
      return NextResponse.json({ error: "Invalid app id" }, { status: 400 });
    }

    const games = await query<{
      app_id: number;
      name: string;
      description: string | null;
      release_date: string | null;
      base_price_usd: string | null;
      developer: string | null;
      concurrent_players: number | null;
      owners_estimate: string | null;
      snapshot_time: string | null;
      current_price: string | null;
      current_price_inr: string | null;
      discount_pct: number | null;
      is_free: boolean;
    }>(
      `
      WITH latest_ccu AS (
        SELECT DISTINCT ON (app_id)
          app_id, concurrent_players, owners_estimate, snapshot_time
        FROM player_counts
        WHERE app_id = $1
        ORDER BY app_id, snapshot_time DESC
      )
      SELECT
        g.app_id,
        g.name,
        g.description,
        g.release_date::text AS release_date,
        g.base_price_usd::text AS base_price_usd,
        d.name AS developer,
        lc.concurrent_players,
        lc.owners_estimate,
        lc.snapshot_time::text AS snapshot_time,
        ph.price::text AS current_price,
        ph_inr.price::text AS current_price_inr,
        ph.discount_pct,
        (${IS_FREE_SQL}) AS is_free
      FROM games g
      LEFT JOIN developers d ON d.dev_id = g.dev_id
      LEFT JOIN latest_ccu lc ON lc.app_id = g.app_id
      LEFT JOIN price_history ph
        ON ph.app_id = g.app_id AND ph.is_current AND ph.currency_code = 'USD'
      LEFT JOIN price_history ph_inr
        ON ph_inr.app_id = g.app_id AND ph_inr.is_current AND ph_inr.currency_code = 'INR'
      WHERE g.app_id = $1
      `,
      [appId],
    );

    if (games.length === 0) {
      return NextResponse.json({ error: "Game not found" }, { status: 404 });
    }

    const game = games[0];

    const [[reviewCounts], [playtime]] = await Promise.all([
      query<{ positive: string; negative: string; total: string }>(
        `
        SELECT
          COUNT(*) FILTER (WHERE is_positive)::text AS positive,
          COUNT(*) FILTER (WHERE NOT is_positive)::text AS negative,
          COUNT(*)::text AS total
        FROM reviews
        WHERE app_id = $1
        `,
        [appId],
      ),
      query<{
        avg_playtime_min: string | null;
        median_playtime_min: string | null;
      }>(
        `
        SELECT
          ROUND(AVG(playtime_at_review), 1)::text AS avg_playtime_min,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY playtime_at_review)::text
            AS median_playtime_min
        FROM reviews
        WHERE app_id = $1 AND playtime_at_review IS NOT NULL
        `,
        [appId],
      ),
    ]);

    const reviews = {
      positive: reviewCounts?.positive ?? "0",
      negative: reviewCounts?.negative ?? "0",
      total: reviewCounts?.total ?? "0",
      avg_playtime_min: playtime?.avg_playtime_min ?? null,
      median_playtime_min: playtime?.median_playtime_min ?? null,
    };

    const [tags, ccuHistory, sampleReviews] = await Promise.all([
      query<{ tag_name: string }>(
        `
        SELECT t.tag_name
        FROM game_tags gt
        JOIN tags t ON t.tag_id = gt.tag_id
        WHERE gt.app_id = $1
        ORDER BY t.tag_name
        `,
        [appId],
      ),
      query<{
        snapshot_time: string;
        concurrent_players: number;
      }>(
        `
        SELECT snapshot_time::text AS snapshot_time, concurrent_players
        FROM player_counts
        WHERE app_id = $1
        ORDER BY snapshot_time DESC
        LIMIT 30
        `,
        [appId],
      ),
      query<{
        review_id: string;
        review_text: string;
        is_positive: boolean;
        playtime_at_review: number | null;
        review_time: string | null;
      }>(
        `
        (
          SELECT review_id::text, review_text, is_positive, playtime_at_review,
                 review_time::text AS review_time
          FROM reviews
          WHERE app_id = $1 AND is_positive AND review_text IS NOT NULL
            AND length(trim(review_text)) > 40
          ORDER BY review_time DESC NULLS LAST
          LIMIT 3
        )
        UNION ALL
        (
          SELECT review_id::text, review_text, is_positive, playtime_at_review,
                 review_time::text AS review_time
          FROM reviews
          WHERE app_id = $1 AND NOT is_positive AND review_text IS NOT NULL
            AND length(trim(review_text)) > 40
          ORDER BY review_time DESC NULLS LAST
          LIMIT 3
        )
        `,
        [appId],
      ),
    ]);

    const pos = Number(reviews.positive) || 0;
    const neg = Number(reviews.negative) || 0;
    const total = Number(reviews.total) || 0;

    return NextResponse.json(
      {
        game: {
          app_id: game.app_id,
          name: game.name,
          description: game.description,
          release_date: game.release_date,
          developer: game.developer,
          base_price_usd:
            game.base_price_usd != null ? Number(game.base_price_usd) : null,
          current_price:
            game.current_price != null ? Number(game.current_price) : null,
          current_price_inr:
            game.current_price_inr != null
              ? Number(game.current_price_inr)
              : null,
          discount_pct: game.discount_pct,
          is_free: !!game.is_free,
          concurrent_players: game.concurrent_players ?? 0,
          owners_estimate: game.owners_estimate ?? "0",
          snapshot_time: game.snapshot_time,
        },
        reviews: {
          positive: pos,
          negative: neg,
          total,
          pos_pct: total ? Math.round((1000 * pos) / total) / 10 : null,
          /** Minutes at review time — closest hours-played signal in warehouse */
          avg_playtime_min:
            reviews.avg_playtime_min != null
              ? Number(reviews.avg_playtime_min)
              : null,
          median_playtime_min:
            reviews.median_playtime_min != null
              ? Number(reviews.median_playtime_min)
              : null,
        },
        tags: tags.map((t) => t.tag_name),
        ccuHistory: ccuHistory
          .slice()
          .reverse()
          .map((r) => ({
            t: r.snapshot_time,
            ccu: Number(r.concurrent_players) || 0,
          })),
        topReviews: sampleReviews.map((r) => {
          const lex = lexiconSentiment(r.review_text ?? "");
          return {
            review_id: r.review_id,
            review_text: r.review_text,
            is_positive: r.is_positive,
            playtime_at_review: r.playtime_at_review,
            review_time: r.review_time,
            lexicon: { label: lex.label, score: lex.score },
          };
        }),
        unavailable: {
          money_spent:
            "No player spend / revenue columns in warehouse — showing list/current price only.",
          hours_played:
            "No lifetime hours-played column — showing avg/median playtime_at_review (minutes) from reviews when present.",
          publisher: "No publisher column — developer only when linked.",
          inr_price:
            game.current_price_inr == null
              ? "No INR row in price_history for this game — Steam India store may not list it (run load_inr_prices.py)."
              : null,
        },
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
        },
      },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
