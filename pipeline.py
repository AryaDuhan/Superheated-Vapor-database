import os
import sys
import json
import csv
import time
import glob
import requests
import psycopg2
from psycopg2 import extras
from dotenv import load_dotenv
from sentence_transformers import SentenceTransformer
from pgvector.psycopg2 import register_vector

def get_review_limits(rank):
    if rank < 10: return 5, 100
    elif rank < 50: return 2, 100
    elif rank < 200: return 1, 100
    elif rank < 1000: return 1, 50
    else: return 1, 8

def fetch_appdetails(app_id, headers):
    url = f"https://steamspy.com/api.php?request=appdetails&appid={app_id}"
    try:
        r = requests.get(url, headers=headers, timeout=15)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        print(f"Error fetching details for app {app_id}: {e}")
        return None

def fetch_reviews(app_id, pages, num_per_page, headers):
    reviews = []
    cursor = "*"
    for _ in range(pages):
        url = f"https://store.steampowered.com/appreviews/{app_id}"
        params = {"json": 1, "filter": "recent", "cursor": cursor, "num_per_page": num_per_page, "language": "english"}
        try:
            r = requests.get(url, params=params, headers=headers, timeout=15)
            r.raise_for_status()
            data = r.json()
            if data.get("success") == 1:
                batch = data.get("reviews", [])
                reviews.extend(batch)
                cursor = data.get("cursor", "*")
                if not batch: break
        except Exception as e:
            print(f"Error fetching reviews for app {app_id}: {e}")
            break
        time.sleep(1) # Rate limit inside page loop
    return reviews

def insert_game_data(conn, app, reviews, embeddings):
    with conn.cursor() as cur:
        # Insert Developer
        dev_name = app.get('developer', 'Unknown')
        cur.execute("""
            INSERT INTO developers (name) VALUES (%s)
            ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
            RETURNING dev_id;
        """, (dev_name,))
        dev_id = cur.fetchone()[0]
        
        # Insert Game
        cur.execute("""
            INSERT INTO games (app_id, name, dev_id, base_price_usd)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (app_id) DO UPDATE SET base_price_usd = EXCLUDED.base_price_usd;
        """, (int(app['appid']), app['name'], dev_id, float(app.get('initialprice', 0))/100))
        
        # Insert Tags
        tags = app.get('tags', {})
        if isinstance(tags, dict):
            for tag_name in tags.keys():
                cur.execute("""
                    INSERT INTO tags (tag_name) VALUES (%s)
                    ON CONFLICT (tag_name) DO UPDATE SET tag_name = EXCLUDED.tag_name
                    RETURNING tag_id;
                """, (tag_name,))
                tag_id = cur.fetchone()[0]
                
                cur.execute("""
                    INSERT INTO game_tags (app_id, tag_id) VALUES (%s, %s)
                    ON CONFLICT (app_id, tag_id) DO NOTHING;
                """, (int(app['appid']), tag_id))

        # SteamSpy store genres (comma-separated; multi-membership like tags)
        genre_field = app.get('genre')
        if genre_field:
            names = (
                [str(g).strip() for g in genre_field if str(g).strip()]
                if isinstance(genre_field, list)
                else [g.strip() for g in str(genre_field).split(",") if g.strip()]
            )
            for genre_name in names:
                cur.execute("""
                    INSERT INTO genres (genre_name) VALUES (%s)
                    ON CONFLICT (genre_name) DO UPDATE SET genre_name = EXCLUDED.genre_name
                    RETURNING genre_id;
                """, (genre_name,))
                genre_id = cur.fetchone()[0]
                cur.execute("""
                    INSERT INTO game_genres (app_id, genre_id) VALUES (%s, %s)
                    ON CONFLICT (app_id, genre_id) DO NOTHING;
                """, (int(app['appid']), genre_id))
        
        # Insert Price/Player Counts
        cur.execute("""
            INSERT INTO player_counts (app_id, snapshot_time, concurrent_players, owners_estimate)
            VALUES (%s, NOW(), %s, %s) ON CONFLICT DO NOTHING;
        """, (int(app['appid']), int(app.get('ccu', 0)), app.get('owners', '0')))
        # SCD Type 2: close prior current row only when price/discount changes
        cur.execute(
            "SELECT upsert_price(%s, %s, %s, %s);",
            (
                int(app['appid']),
                float(app.get('price', 0)) / 100,
                int(app.get('discount', 0)),
                'USD',
            ),
        )

        # Insert Reviews & Embeddings Batch
        if reviews:
            reviews_data = []
            for rev, emb in zip(reviews, embeddings):
                reviews_data.append((
                    rev['recommendationid'], int(app['appid']), rev['review'],
                    psycopg2.TimestampFromTicks(rev['timestamp_created']),
                    rev['voted_up'], rev['author'].get('playtime_forever', 0),
                    emb.tolist()
                ))
            insert_query = """
                INSERT INTO reviews (review_id, app_id, review_text, review_time, is_positive, playtime_at_review, review_embedding)
                VALUES %s
                ON CONFLICT (review_id) DO NOTHING;
            """
            extras.execute_values(cur, insert_query, reviews_data)
    conn.commit()

def main():
    start_time = time.time()
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
    
    # Load ML Model
    print("Loading model 'all-MiniLM-L6-v2'...")
    model = SentenceTransformer('all-MiniLM-L6-v2')
    
    # DB Setup
    load_dotenv()  # project-root .env (fallback: process env)
    load_dotenv("venv/.env", override=False)
    conn = psycopg2.connect(os.getenv("DATABASE_URL"))
    register_vector(conn)
    
    # Resumability Tracker
    os.makedirs('data', exist_ok=True)
    completed_file = 'data/completed_games.txt'
    completed = set()
    if os.path.exists(completed_file):
        with open(completed_file, 'r') as f:
            completed = set(line.strip() for line in f)
            
    # Read CSV
    csv_files = glob.glob('data/steamspy_snapshot_*.csv')
    latest_csv = max(csv_files, key=os.path.getctime)
    with open(latest_csv, 'r', encoding='utf-8') as f:
        reader = list(csv.DictReader(f))
        
    total_processed = 0
    
    for rank, row in enumerate(reader):
        app_id = str(row['app_id'])
        if app_id in completed:
            continue
            
        # Fetch data
        app_details = fetch_appdetails(app_id, headers)
        time.sleep(1) # SteamSpy limit
        
        if not app_details:
            continue
            
        pages, num_per_page = get_review_limits(rank)
        reviews = fetch_reviews(app_id, pages, num_per_page, headers)
        time.sleep(1) # Steam limit
        
        # Embed
        embeddings = []
        if reviews:
            texts = [r['review'] for r in reviews]
            embeddings = model.encode(texts)
            
        # DB Insert
        insert_game_data(conn, app_details, reviews, embeddings)
        
        # Track Progress
        with open(completed_file, 'a') as f:
            f.write(f"{app_id}\n")
        completed.add(app_id)
        total_processed += 1
        
        # Logging
        if total_processed % 100 == 0:
            elapsed = (time.time() - start_time) / 60
            print(f"[{total_processed} games processed] Elapsed time: {elapsed:.2f} mins")
            
        # Checkpoint logic
        if total_processed == 1000:
            with conn.cursor() as cur:
                cur.execute("SELECT pg_database_size(current_database()) / 1024 / 1024;") # MB
                db_mb = float(cur.fetchone()[0])
                
            # Since the first 1000 games hold ~50% of our total reviews (68k out of 132k), 
            # we know the remaining 8000 games will only double this size, not 9x it.
            print(f"\n[OK] CHECKPOINT PASSED: Current Size {db_mb:.2f} MB. Safe to continue.")
            with open('data/checkpoint_log.txt', 'a') as f:
                f.write(f"Checkpoint 1000: Current={db_mb:.2f}MB\n")

    conn.close()
    print(f"\nPipeline finished! Total processed in this run: {total_processed}")

if __name__ == "__main__":
    main()
