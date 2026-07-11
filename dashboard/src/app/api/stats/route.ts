import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import {
  isGameRelevantTagSql,
  isRealGameSql,
  NON_GAME_APP_IDS,
  nonGameTagsLower,
  toolTagsLower,
} from "@/lib/gameFilters";
import { IS_FREE_SQL } from "@/lib/isFree";

export const runtime = "nodejs";

export async function GET() {
  try {
    const denyToolTags = toolTagsLower();
    const denyNicheTags = nonGameTagsLower();
    const denyAppIds = [...NON_GAME_APP_IDS];
    const realGame = isRealGameSql({
      toolTagsParam: "$1",
      appIdsParam: "$2",
    });

    const [stats] = await query<{
      games: string;
      reviews: string;
      tags: string;
      developers: string;
      pos: string;
      neg: string;
      free: string;
      paid: string;
    }>(`
      SELECT
        (SELECT COUNT(*)::text FROM games) AS games,
        (SELECT COUNT(*)::text FROM reviews) AS reviews,
        (SELECT COUNT(*)::text FROM tags) AS tags,
        (SELECT COUNT(*)::text FROM developers) AS developers,
        (SELECT COUNT(*)::text FROM reviews WHERE is_positive) AS pos,
        (SELECT COUNT(*)::text FROM reviews WHERE NOT is_positive) AS neg,
        (SELECT COUNT(*)::text FROM games g WHERE ${IS_FREE_SQL}) AS free,
        (SELECT COUNT(*)::text FROM games g WHERE NOT ${IS_FREE_SQL}) AS paid
    `);

    const topGames = await query<{
      app_id: number;
      name: string;
      concurrent_players: number;
      owners_estimate: string;
      is_free: boolean;
    }>(
      `
      WITH latest_ccu AS (
        SELECT DISTINCT ON (app_id)
          app_id, concurrent_players, owners_estimate
        FROM player_counts
        ORDER BY app_id, snapshot_time DESC
      )
      SELECT
        g.app_id,
        g.name,
        lc.concurrent_players,
        lc.owners_estimate,
        (${IS_FREE_SQL}) AS is_free
      FROM latest_ccu lc
      JOIN games g ON g.app_id = lc.app_id
      WHERE ${realGame}
      ORDER BY lc.concurrent_players DESC NULLS LAST
      LIMIT 10
      `,
      [denyToolTags, denyAppIds],
    );

    const tagGaps = await query<{
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
      LIMIT 8
      `,
      [denyToolTags, denyAppIds, denyNicheTags],
    );

    return NextResponse.json(
      {
        stats,
        topGames,
        tagGaps,
        freePaid: {
          free: Number(stats.free) || 0,
          paid: Number(stats.paid) || 0,
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
