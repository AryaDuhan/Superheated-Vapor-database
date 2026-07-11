"""Load latest SteamSpy CSV into player_counts + SCD2 prices."""
import glob
import os
import csv
from datetime import datetime, timezone

import psycopg2
from dotenv import load_dotenv

load_dotenv()
load_dotenv("venv/.env", override=False)


def main():
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    cur = conn.cursor()

    files = sorted(glob.glob("data/steamspy_snapshot_*.csv"))
    if not files:
        # GitHub Actions: fetch script writes here
        files = sorted(glob.glob("steamspy_snapshot_*.csv"))
    if not files:
        raise SystemExit("No steamspy_snapshot_*.csv found")

    path = files[-1]
    print(f"Loading {path}")

    inserted_pc = 0
    priced = 0
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            app_id = int(row["app_id"])
            snap = row.get("snapshot_time") or datetime.now(timezone.utc).isoformat()
            owners = row.get("owners") or "0"
            price_cents = float(row.get("price") or 0)
            discount = int(float(row.get("discount") or 0))

            # Ensure game stub exists so FKs succeed for new app ids
            cur.execute(
                """
                INSERT INTO games (app_id, name)
                VALUES (%s, %s)
                ON CONFLICT (app_id) DO NOTHING
                """,
                (app_id, row.get("name") or f"app_{app_id}"),
            )

            cur.execute(
                """
                INSERT INTO player_counts (app_id, snapshot_time, concurrent_players, owners_estimate)
                VALUES (%s, %s, NULL, %s)
                ON CONFLICT DO NOTHING
                """,
                (app_id, snap, owners),
            )
            if cur.rowcount:
                inserted_pc += 1

            cur.execute(
                "SELECT upsert_price(%s, %s, %s, %s)",
                (app_id, price_cents / 100.0, discount, "USD"),
            )
            priced += 1

    conn.commit()
    cur.close()
    conn.close()
    print(f"Done. new_player_count_rows={inserted_pc} upsert_price_calls={priced}")


if __name__ == "__main__":
    main()
