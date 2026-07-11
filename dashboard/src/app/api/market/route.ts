import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  try {
    const pairs = await query<{
      tag_a: string;
      tag_b: string;
      co_occurrences: string;
    }>(`
      SELECT t1.tag_name AS tag_a, t2.tag_name AS tag_b, COUNT(*)::text AS co_occurrences
      FROM game_tags gt1
      JOIN game_tags gt2 ON gt1.app_id = gt2.app_id AND gt1.tag_id < gt2.tag_id
      JOIN tags t1 ON gt1.tag_id = t1.tag_id
      JOIN tags t2 ON gt2.tag_id = t2.tag_id
      GROUP BY 1, 2
      ORDER BY COUNT(*) DESC
      LIMIT 12
    `);

    const gaps = await query<{
      tag_name: string;
      num_games: string;
      avg_players: string;
      ratio: string;
    }>(`
      WITH latest_ccu AS (
        SELECT DISTINCT ON (app_id) app_id, concurrent_players
        FROM player_counts
        ORDER BY app_id, snapshot_time DESC
      ),
      tag_supply AS (
        SELECT tag_id, COUNT(*) AS num_games FROM game_tags GROUP BY tag_id
      ),
      tag_demand AS (
        SELECT gt.tag_id, AVG(lc.concurrent_players)::numeric AS avg_players
        FROM game_tags gt
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
      ORDER BY (d.avg_players / NULLIF(s.num_games, 0)) DESC
      LIMIT 12
    `);

    return NextResponse.json(
      { pairs, gaps },
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
