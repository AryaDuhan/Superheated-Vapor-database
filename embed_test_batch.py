import os
import psycopg2
from dotenv import load_dotenv
from sentence_transformers import SentenceTransformer
from pgvector.psycopg2 import register_vector

def main():
    load_dotenv()  # project-root .env
    load_dotenv("venv/.env", override=False)
    conn = psycopg2.connect(os.getenv("DATABASE_URL"))
    
    # Enable vector capabilities for the connection
    register_vector(conn)
    
    print("Loading model 'all-MiniLM-L6-v2'...")
    model = SentenceTransformer('all-MiniLM-L6-v2')
    
    print("Fetching reviews without embeddings...")
    with conn.cursor() as cur:
        cur.execute("SELECT review_id, review_text FROM reviews WHERE review_embedding IS NULL;")
        rows = cur.fetchall()
        
    print(f"Found {len(rows)} reviews. Generating embeddings...")
    
    batch_size = 500
    for i in range(0, len(rows), batch_size):
        batch = rows[i:i+batch_size]
        review_ids = [row[0] for row in batch]
        texts = [row[1] for row in batch]
        
        # Generate embeddings
        embeddings = model.encode(texts)
        
        # Update database
        with conn.cursor() as cur:
            for review_id, embedding in zip(review_ids, embeddings):
                # We format the numpy array to a list so psycopg2/pgvector handles it correctly
                # It will automatically be cast to halfvec by Postgres because of the column type
                cur.execute(
                    "UPDATE reviews SET review_embedding = %s WHERE review_id = %s;",
                    (embedding.tolist(), review_id)
                )
            conn.commit()
            print(f"Processed {min(i+batch_size, len(rows))}/{len(rows)}")

    conn.close()
    print("Finished embedding test batch.")

if __name__ == "__main__":
    main()
