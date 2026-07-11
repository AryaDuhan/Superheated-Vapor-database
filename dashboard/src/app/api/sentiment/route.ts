import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  try {
    const overall = await query<{
      positive: string;
      negative: string;
      total: string;
    }>(`
      SELECT
        COUNT(*) FILTER (WHERE is_positive)::text AS positive,
        COUNT(*) FILTER (WHERE NOT is_positive)::text AS negative,
        COUNT(*)::text AS total
      FROM reviews
    `);

    const byGame = await query<{
      app_id: number;
      name: string;
      positive: string;
      negative: string;
      total: string;
      pos_pct: string;
    }>(`
      SELECT
        g.app_id,
        g.name,
        COUNT(*) FILTER (WHERE r.is_positive)::text AS positive,
        COUNT(*) FILTER (WHERE NOT r.is_positive)::text AS negative,
        COUNT(*)::text AS total,
        ROUND(100.0 * COUNT(*) FILTER (WHERE r.is_positive) / NULLIF(COUNT(*), 0), 1)::text AS pos_pct
      FROM reviews r
      JOIN games g ON g.app_id = r.app_id
      GROUP BY g.app_id, g.name
      HAVING COUNT(*) >= 40
      ORDER BY COUNT(*) DESC
      LIMIT 10
    `);

    const daily = await query<{
      day: string;
      positive: string;
      negative: string;
    }>(`
      SELECT
        DATE_TRUNC('day', review_time)::date::text AS day,
        COUNT(*) FILTER (WHERE is_positive)::text AS positive,
        COUNT(*) FILTER (WHERE NOT is_positive)::text AS negative
      FROM reviews
      WHERE review_time > now() - interval '90 days'
      GROUP BY 1
      ORDER BY 1
    `);

    return NextResponse.json(
      { overall: overall[0], byGame, daily },
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
