import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { embedText, toHalfvecLiteral } from "@/lib/embed";
import { lexiconSentiment } from "@/lib/sentiment";

export const runtime = "nodejs";
export const maxDuration = 60;

type Hit = {
  review_id: string;
  app_id: number;
  name: string;
  review_text: string;
  is_positive: boolean;
  similarity: number;
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const q = String(body.query ?? "").trim();
    const limit = Math.min(Number(body.limit ?? 12), 30);
    if (!q) {
      return NextResponse.json({ error: "query required" }, { status: 400 });
    }

    const vector = await embedText(q);
    const literal = toHalfvecLiteral(vector);

    const rows = await query<Hit>(
      `
      SELECT
        r.review_id::text,
        r.app_id,
        g.name,
        LEFT(r.review_text, 600) AS review_text,
        r.is_positive,
        (1 - (r.review_embedding <=> $1::halfvec))::float8 AS similarity
      FROM reviews r
      JOIN games g ON g.app_id = r.app_id
      WHERE r.review_embedding IS NOT NULL
      ORDER BY r.review_embedding <=> $1::halfvec
      LIMIT $2
      `,
      [literal, limit],
    );

    const results = rows.map((r) => ({
      ...r,
      lexicon: lexiconSentiment(r.review_text ?? ""),
    }));

    return NextResponse.json({ query: q, results });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
