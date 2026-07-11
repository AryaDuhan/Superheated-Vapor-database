"""
One-shot: create genres tables (if needed) and load SteamSpy genres into Neon.

Sources (in order):
1. data/appdetails.json (local cache)
2. SteamSpy appdetails API for games still missing genres

Membership: every comma-separated genre is linked (same multi-membership as tags).
Does not invent genre names — only parses SteamSpy's `genre` field.
"""
from __future__ import annotations

import json
import os
import time
from pathlib import Path

import psycopg2
import requests
from dotenv import load_dotenv

from insert_data import parse_genres, upsert_game_genres

ROOT = Path(__file__).resolve().parent
JSON_PATH = ROOT / "data" / "appdetails.json"
PROGRESS_PATH = ROOT / "data" / "genre_backfill_done.txt"
MIGRATION_PATH = ROOT / "sql" / "10_genres.sql"
STEAMSPY_URL = "https://steamspy.com/api.php?request=appdetails&appid={app_id}"
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; steam-sql-analytics/1.0)"}


def connect():
    load_dotenv(ROOT / ".env")
    load_dotenv(ROOT / "venv" / ".env", override=False)
    url = os.getenv("DATABASE_URL")
    if not url:
        raise SystemExit("DATABASE_URL not set")
    return psycopg2.connect(url)


def apply_migration(conn):
    sql = MIGRATION_PATH.read_text(encoding="utf-8")
    with conn.cursor() as cur:
        cur.execute(sql)
    conn.commit()
    print("Applied", MIGRATION_PATH.name)


def load_json_genres(conn) -> int:
    if not JSON_PATH.exists():
        print("No", JSON_PATH)
        return 0
    apps = json.loads(JSON_PATH.read_text(encoding="utf-8"))
    linked = 0
    with conn.cursor() as cur:
        for app in apps:
            app_id = int(app["appid"])
            # Skip apps not in games (FK)
            cur.execute("SELECT 1 FROM games WHERE app_id = %s", (app_id,))
            if not cur.fetchone():
                continue
            before = cur.rowcount
            upsert_game_genres(cur, app_id, app.get("genre"))
            if parse_genres(app.get("genre")):
                linked += 1
    conn.commit()
    print(f"JSON: linked genres for {linked}/{len(apps)} apps present in games")
    return linked


def missing_app_ids(conn) -> list[int]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT g.app_id
            FROM games g
            WHERE NOT EXISTS (
                SELECT 1 FROM game_genres gg WHERE gg.app_id = g.app_id
            )
            ORDER BY g.app_id
            """
        )
        return [r[0] for r in cur.fetchall()]


def load_done() -> set[int]:
    if not PROGRESS_PATH.exists():
        return set()
    return {
        int(line.strip())
        for line in PROGRESS_PATH.read_text(encoding="utf-8").splitlines()
        if line.strip().isdigit()
    }


def mark_done(app_id: int):
    with PROGRESS_PATH.open("a", encoding="utf-8") as f:
        f.write(f"{app_id}\n")


def fetch_and_insert(
    conn,
    app_ids: list[int],
    sleep_s: float = 1.0,
    workers: int = 1,
):
    from concurrent.futures import ThreadPoolExecutor, as_completed
    import threading

    done = load_done()
    todo = [a for a in app_ids if a not in done]
    print(
        f"SteamSpy fetch: {len(todo)} apps need genre "
        f"(skipping {len(done)} already attempted, workers={workers})"
    )
    ok = 0
    empty = 0
    err = 0
    lock = threading.Lock()
    progress_lock = threading.Lock()

    def one(app_id: int):
        nonlocal ok, empty, err
        try:
            r = requests.get(
                STEAMSPY_URL.format(app_id=app_id),
                headers=HEADERS,
                timeout=20,
            )
            r.raise_for_status()
            data = r.json()
            genre = data.get("genre") if isinstance(data, dict) else None
            with lock:
                with conn.cursor() as cur:
                    cur.execute("SELECT 1 FROM games WHERE app_id = %s", (app_id,))
                    if cur.fetchone():
                        upsert_game_genres(cur, app_id, genre)
                conn.commit()
            with progress_lock:
                if parse_genres(genre):
                    ok += 1
                else:
                    empty += 1
                mark_done(app_id)
                return True
        except Exception as e:
            with lock:
                try:
                    conn.rollback()
                except Exception:
                    pass
            with progress_lock:
                err += 1
                mark_done(app_id)
            print(f"  [{app_id}] error: {e}")
            return False

    if workers <= 1:
        for i, app_id in enumerate(todo, 1):
            one(app_id)
            if i % 25 == 0 or i == len(todo):
                print(f"  [{i}/{len(todo)}] ok={ok} empty={empty} err={err}")
            time.sleep(sleep_s)
    else:
        # ponytail: small pool; SteamSpy soft-rate-limits — bump workers only if empty/err stay low
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futs = []
            for i, app_id in enumerate(todo, 1):
                futs.append(pool.submit(one, app_id))
                time.sleep(sleep_s)
                if i % 25 == 0:
                    print(f"  queued {i}/{len(todo)} ok={ok} empty={empty} err={err}")
            for fut in as_completed(futs):
                fut.result()
        print(f"  final ok={ok} empty={empty} err={err}")

    print(f"SteamSpy done: ok={ok} empty={empty} err={err}")


def print_stats(conn):
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM genres")
        n_genres = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM game_genres")
        n_links = cur.fetchone()[0]
        cur.execute("SELECT COUNT(DISTINCT app_id) FROM game_genres")
        n_apps = cur.fetchone()[0]
        cur.execute(
            """
            SELECT genre_name, COUNT(*) AS n
            FROM game_genres gg
            JOIN genres g ON g.genre_id = gg.genre_id
            GROUP BY genre_name
            ORDER BY n DESC
            """
        )
        rows = cur.fetchall()
    print(f"genres={n_genres} game_genres={n_links} apps_with_genre={n_apps}")
    for name, n in rows:
        print(f"  {name}: {n}")


def main():
    import argparse

    p = argparse.ArgumentParser()
    p.add_argument(
        "--json-only",
        action="store_true",
        help="Only load data/appdetails.json (no SteamSpy fetch)",
    )
    p.add_argument(
        "--fetch",
        action="store_true",
        help="Fetch missing genres from SteamSpy (~1 req/s)",
    )
    p.add_argument("--sleep", type=float, default=1.0)
    p.add_argument(
        "--workers",
        type=int,
        default=1,
        help="Concurrent SteamSpy fetches (keep low; default 1)",
    )
    args = p.parse_args()

    conn = connect()
    try:
        apply_migration(conn)
        load_json_genres(conn)
        if args.fetch and not args.json_only:
            missing = missing_app_ids(conn)
            if missing:
                fetch_and_insert(
                    conn, missing, sleep_s=args.sleep, workers=args.workers
                )
            else:
                print("No games missing genres")
        elif not args.json_only and not args.fetch:
            # default: json + fetch missing
            missing = missing_app_ids(conn)
            if missing:
                print(f"{len(missing)} games still missing genres — fetching SteamSpy…")
                fetch_and_insert(
                    conn, missing, sleep_s=args.sleep, workers=args.workers
                )
        print_stats(conn)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
