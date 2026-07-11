import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  try {
    const bombs = await query<{
      app_id: number;
      name: string;
      review_day: string;
      negative_count: string;
      total_count: string;
      z_score: string;
    }>(`
      WITH daily_reviews AS (
        SELECT
          app_id,
          DATE_TRUNC('day', review_time) AS review_day,
          COUNT(*) FILTER (WHERE is_positive = FALSE) AS negative_count,
          COUNT(*) AS total_count
        FROM reviews
        GROUP BY 1, 2
        HAVING COUNT(*) >= 5
      ),
      with_stats AS (
        SELECT *,
          AVG(negative_count) OVER (PARTITION BY app_id) AS avg_neg,
          STDDEV(negative_count) OVER (PARTITION BY app_id) AS stddev_neg
        FROM daily_reviews
      )
      SELECT
        w.app_id,
        g.name,
        w.review_day::date::text AS review_day,
        w.negative_count::text,
        w.total_count::text,
        ROUND(((w.negative_count - w.avg_neg) / NULLIF(w.stddev_neg, 0))::numeric, 2)::text AS z_score
      FROM with_stats w
      JOIN games g ON g.app_id = w.app_id
      WHERE (w.negative_count - w.avg_neg) / NULLIF(w.stddev_neg, 0) > 2
      ORDER BY ((w.negative_count - w.avg_neg) / NULLIF(w.stddev_neg, 0)) DESC
      LIMIT 20
    `);

    const studios = await query<{
      path: string;
      depth: string;
      game_count: string;
    }>(`
      WITH RECURSIVE linked AS (
        SELECT dev_id, name, parent_dev_id, name::TEXT AS path, 0 AS depth
        FROM developers
        WHERE parent_dev_id IS NULL
          AND dev_id IN (SELECT DISTINCT parent_dev_id FROM developers WHERE parent_dev_id IS NOT NULL)
        UNION ALL
        SELECT d.dev_id, d.name, d.parent_dev_id, l.path || ' › ' || d.name, l.depth + 1
        FROM developers d
        JOIN linked l ON d.parent_dev_id = l.dev_id
      )
      SELECT path, depth::text, COUNT(g.app_id)::text AS game_count
      FROM linked l
      LEFT JOIN games g ON g.dev_id = l.dev_id
      GROUP BY path, depth
      ORDER BY path
    `);

    return NextResponse.json(
      { bombs, studios },
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
