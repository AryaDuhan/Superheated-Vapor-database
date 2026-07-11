import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

export const runtime = "nodejs";

type GameHit = {
  app_id: number;
  name: string;
  concurrent_players: number | null;
  owners_estimate: string | null;
};

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const q = String(sp.get("q") ?? "").trim();
    const limit = Math.min(Math.max(Number(sp.get("limit") ?? 8), 1), 20);

    if (!q) {
      return NextResponse.json({ query: "", games: [] });
    }

    // Prefix-friendly ILIKE; escape LIKE wildcards in user input.
    const escaped = q.replace(/[%_\\]/g, "\\$&");
    const pattern = `%${escaped}%`;

    // Correlate CCU only for the few name matches (keeps header search fast).
    const rows = await query<GameHit>(
      `
      SELECT
        g.app_id,
        g.name,
        (
          SELECT pc.concurrent_players
          FROM player_counts pc
          WHERE pc.app_id = g.app_id
          ORDER BY pc.snapshot_time DESC
          LIMIT 1
        ) AS concurrent_players,
        (
          SELECT pc.owners_estimate
          FROM player_counts pc
          WHERE pc.app_id = g.app_id
          ORDER BY pc.snapshot_time DESC
          LIMIT 1
        ) AS owners_estimate
      FROM games g
      WHERE g.name ILIKE $1 ESCAPE '\\'
      ORDER BY
        CASE
          WHEN g.name ILIKE $2 ESCAPE '\\' THEN 0
          WHEN g.name ILIKE $3 ESCAPE '\\' THEN 1
          ELSE 2
        END,
        g.name ASC
      LIMIT $4
      `,
      [pattern, `${escaped}%`, `% ${escaped}%`, limit],
    );

    return NextResponse.json(
      {
        query: q,
        games: rows.map((g) => ({
          app_id: g.app_id,
          name: g.name,
          concurrent_players: Number(g.concurrent_players) || 0,
          owners_estimate: g.owners_estimate ?? "0",
        })),
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
