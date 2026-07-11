import { NextResponse } from "next/server";
import { embedText } from "@/lib/embed";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Prefetch / warm the MiniLM pipeline so the first real search is faster. */
export async function GET() {
  try {
    await embedText("warmup");
    return NextResponse.json(
      { ok: true },
      {
        headers: {
          "Cache-Control": "private, max-age=3600",
        },
      },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
