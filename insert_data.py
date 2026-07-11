import os, json, psycopg2
from psycopg2 import extras
from dotenv import load_dotenv

def get_db_connection():
    load_dotenv()  # project-root .env
    load_dotenv("venv/.env", override=False)
    return psycopg2.connect(os.getenv("DATABASE_URL"))


def parse_genres(genre_field):
    """SteamSpy `genre` is a comma-separated string; never invent names."""
    if not genre_field:
        return []
    if isinstance(genre_field, list):
        return [str(g).strip() for g in genre_field if str(g).strip()]
    return [g.strip() for g in str(genre_field).split(",") if g.strip()]


def upsert_game_genres(cur, app_id, genre_field):
    for genre_name in parse_genres(genre_field):
        cur.execute(
            """
            INSERT INTO genres (genre_name) VALUES (%s)
            ON CONFLICT (genre_name) DO UPDATE SET genre_name = EXCLUDED.genre_name
            RETURNING genre_id;
            """,
            (genre_name,),
        )
        genre_id = cur.fetchone()[0]
        cur.execute(
            """
            INSERT INTO game_genres (app_id, genre_id) VALUES (%s, %s)
            ON CONFLICT (app_id, genre_id) DO NOTHING;
            """,
            (app_id, genre_id),
        )

def insert_app_details(conn):
    json_path = 'data/appdetails.json'
    if not os.path.exists(json_path):
        print("No appdetails.json found.")
        return
        
    with open(json_path, 'r', encoding='utf-8') as f:
        apps = json.load(f)
        
    with conn.cursor() as cur:
        for app in apps:
            # 1. Insert Developer
            dev_name = app.get('developer', 'Unknown')
            cur.execute("""
                INSERT INTO developers (name) VALUES (%s)
                ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
                RETURNING dev_id;
            """, (dev_name,))
            dev_id = cur.fetchone()[0]
            
            # 2. Insert Game
            cur.execute("""
                INSERT INTO games (app_id, name, dev_id, base_price_usd)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (app_id) DO UPDATE SET 
                    base_price_usd = EXCLUDED.base_price_usd;
            """, (int(app['appid']), app['name'], dev_id, float(app.get('initialprice', 0))/100))
            
            # 3. Insert Tags
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

            # 3b. SteamSpy store genres (multi-membership)
            upsert_game_genres(cur, int(app['appid']), app.get('genre'))
            
            # 4. Insert Player Counts
            cur.execute("""
                INSERT INTO player_counts (app_id, snapshot_time, concurrent_players, owners_estimate)
                VALUES (%s, NOW(), %s, %s)
                ON CONFLICT (app_id, snapshot_time) DO NOTHING;
            """, (int(app['appid']), int(app.get('ccu', 0)), app.get('owners', '0')))
            
            # 5. SCD Type 2 price history (no duplicate current rows on re-run)
            cur.execute(
                "SELECT upsert_price(%s, %s, %s, %s);",
                (
                    int(app['appid']),
                    float(app.get('price', 0)) / 100,
                    int(app.get('discount', 0)),
                    'USD',
                ),
            )

        conn.commit()
    print(f"Successfully inserted {len(apps)} app details (games, tags, genres, devs, prices).")

def insert_reviews(conn):
    json_path = 'data/reviews.json'
    if not os.path.exists(json_path):
        print("No reviews JSON found.")
        return
        
    with open(json_path, 'r', encoding='utf-8') as f:
        reviews = json.load(f)
        
    reviews_data = []
    for rev in reviews:
        reviews_data.append((
            rev['review_id'], rev['app_id'], rev['review_text'],
            psycopg2.TimestampFromTicks(rev['review_time']),
            rev['is_positive'], rev['playtime_at_review']
        ))

    insert_query = """
        INSERT INTO reviews (review_id, app_id, review_text, review_time, is_positive, playtime_at_review)
        VALUES %s
        ON CONFLICT (review_id) DO NOTHING;
    """
    
    with conn.cursor() as cur:
        extras.execute_values(cur, insert_query, reviews_data)
        conn.commit()
    print(f"Successfully inserted {len(reviews_data)} reviews.")

if __name__ == "__main__":
    conn = get_db_connection()
    try:
        insert_app_details(conn)
        insert_reviews(conn)
    finally:
        conn.close()
