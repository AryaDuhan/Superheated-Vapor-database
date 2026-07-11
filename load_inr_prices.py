"""
Ingest real Steam India (INR) store prices into price_history.

Re-run:
  python load_inr_prices.py                  # all games in DB, CCU-ordered
  python load_inr_prices.py --limit 50       # top-N by latest CCU
  python load_inr_prices.py --skip-existing  # skip apps that already have current INR
  python load_inr_prices.py --batch-size 20 --delay 1.5

Uses Steam store appdetails?cc=in (not FX conversion from USD).
Requires DATABASE_URL in .env / venv/.env and upsert_price() from sql/04_scd2_upsert_price.sql.
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from typing import Any

import psycopg2
import requests
from dotenv import load_dotenv

STEAM_APPDETAILS = "https://store.steampowered.com/api/appdetails"
HEADERS = {
    "User-Agent": "steam-sql-analytics/1.0 (+INR price ingest; respectful rate limits)",
    "Accept": "application/json",
}


def get_db_connection():
    load_dotenv()
    load_dotenv("venv/.env", override=False)
    url = os.getenv("DATABASE_URL")
    if not url:
        raise SystemExit("DATABASE_URL not set (.env / venv/.env)")
    return psycopg2.connect(url)


def fetch_app_ids(conn, limit: int | None, skip_existing: bool) -> list[int]:
    """Prefer highest latest CCU so dashboard top lists get INR first."""
    sql = """
        SELECT g.app_id
        FROM games g
        LEFT JOIN LATERAL (
            SELECT concurrent_players
            FROM player_counts pc
            WHERE pc.app_id = g.app_id
            ORDER BY snapshot_time DESC
            LIMIT 1
        ) p ON TRUE
    """
    if skip_existing:
        sql += """
        WHERE NOT EXISTS (
            SELECT 1 FROM price_history ph
            WHERE ph.app_id = g.app_id
              AND ph.currency_code = 'INR'
              AND ph.is_current
        )
        """
    sql += " ORDER BY COALESCE(p.concurrent_players, 0) DESC NULLS LAST, g.app_id"
    if limit is not None:
        sql += f" LIMIT {int(limit)}"

    with conn.cursor() as cur:
        cur.execute(sql)
        return [row[0] for row in cur.fetchall()]


def parse_price_overview(payload: dict[str, Any], app_id: int) -> tuple[float, int] | None:
    """
    Return (price_inr, discount_pct) from one appdetails entry.
    Free / no overview → (0.0, 0). success=false → None (skip).
    """
    entry = payload.get(str(app_id))
    if entry is None:
        return None
    if not entry.get("success"):
        return None

    data = entry.get("data")
    if not isinstance(data, dict):
        # filters=price_overview on free titles often returns data: []
        return 0.0, 0

    overview = data.get("price_overview")
    if not overview:
        if data.get("is_free"):
            return 0.0, 0
        return 0.0, 0

    currency = (overview.get("currency") or "").upper()
    if currency and currency != "INR":
        # Unexpected region; do not invent FX — skip
        print(f"  skip app_id={app_id}: currency={currency} (want INR)")
        return None

    final_units = overview.get("final")
    if final_units is None:
        return None
    # Steam amounts are in minor units (paise for INR)
    price = float(final_units) / 100.0
    discount = int(overview.get("discount_percent") or 0)
    return price, discount


def fetch_batch(app_ids: list[int], session: requests.Session) -> dict[str, Any] | None:
    params = {
        "appids": ",".join(str(a) for a in app_ids),
        "cc": "in",
        "filters": "price_overview",
    }
    try:
        r = session.get(STEAM_APPDETAILS, params=params, headers=HEADERS, timeout=30)
    except requests.RequestException as e:
        print(f"  request error: {e}")
        return None

    if r.status_code == 429:
        print("  HTTP 429 rate limited")
        return None
    if r.status_code != 200:
        print(f"  HTTP {r.status_code}")
        return None

    try:
        data = r.json()
    except ValueError:
        print("  non-JSON response (possible block)")
        return None
    if data is None:
        print("  empty JSON (Steam throttle)")
        return None
    return data


def upsert_inr(conn, app_id: int, price: float, discount: int) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT upsert_price(%s, %s, %s, %s);",
            (app_id, price, discount, "INR"),
        )


def main() -> int:
    parser = argparse.ArgumentParser(description="Load Steam India INR prices into price_history")
    parser.add_argument("--limit", type=int, default=None, help="Max games (CCU-ordered)")
    parser.add_argument("--batch-size", type=int, default=20, help="Apps per Steam request")
    parser.add_argument(
        "--delay",
        type=float,
        default=1.5,
        help="Seconds between Steam requests (rate-limit friendly)",
    )
    parser.add_argument(
        "--skip-existing",
        action="store_true",
        help="Skip apps that already have a current INR row",
    )
    parser.add_argument(
        "--commit-every",
        type=int,
        default=5,
        help="Commit after this many successful batches",
    )
    args = parser.parse_args()

    try:
        conn = get_db_connection()
    except Exception as e:
        print(f"DB connection failed: {e}", file=sys.stderr)
        return 1

    try:
        app_ids = fetch_app_ids(conn, args.limit, args.skip_existing)
        print(f"Apps to process: {len(app_ids)} (batch={args.batch_size}, delay={args.delay}s)")
        if not app_ids:
            print("Nothing to do.")
            return 0

        session = requests.Session()
        ok = skipped = failed_batches = 0
        batch_ok = 0

        for i in range(0, len(app_ids), args.batch_size):
            batch = app_ids[i : i + args.batch_size]
            print(f"Batch {i // args.batch_size + 1}: apps {batch[0]}..{batch[-1]} (n={len(batch)})")

            payload = fetch_batch(batch, session)
            if payload is None:
                failed_batches += 1
                # Back off harder on throttle, then continue
                time.sleep(max(args.delay * 3, 5.0))
                # Retry once
                payload = fetch_batch(batch, session)
                if payload is None:
                    print("  retry failed; skipping batch")
                    time.sleep(args.delay)
                    continue

            for app_id in batch:
                parsed = parse_price_overview(payload, app_id)
                if parsed is None:
                    skipped += 1
                    continue
                price, discount = parsed
                try:
                    upsert_inr(conn, app_id, price, discount)
                    ok += 1
                except Exception as e:
                    print(f"  upsert failed app_id={app_id}: {e}")
                    conn.rollback()
                    skipped += 1

            batch_ok += 1
            if batch_ok % args.commit_every == 0:
                conn.commit()
                print(f"  committed (upserted_so_far={ok})")

            time.sleep(args.delay)

        conn.commit()
        print(
            f"Done. upserted={ok} skipped={skipped} failed_batches={failed_batches}"
        )

        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT COUNT(*) FROM price_history
                WHERE currency_code = 'INR' AND is_current
                """
            )
            print(f"Current INR rows in DB: {cur.fetchone()[0]}")
            cur.execute(
                """
                SELECT app_id, price, discount_pct
                FROM price_history
                WHERE currency_code = 'INR' AND is_current
                ORDER BY price DESC NULLS LAST
                LIMIT 5
                """
            )
            sample = cur.fetchall()
            print("Sample INR rows (top by price):", sample)

        return 0 if ok else 1
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
