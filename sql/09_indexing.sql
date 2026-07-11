-- Phase 9: Indexing & performance notes
-- player_counts time indexes already applied in Phase 5.
-- Add review / embedding indexes used by the dashboard.

CREATE INDEX IF NOT EXISTS idx_reviews_app_time
    ON reviews (app_id, review_time DESC);

CREATE INDEX IF NOT EXISTS idx_reviews_is_positive
    ON reviews (is_positive);

-- Cosine ANN for semantic search (halfvec / pgvector)
CREATE INDEX IF NOT EXISTS idx_reviews_embedding_hnsw
    ON reviews
    USING hnsw (review_embedding halfvec_cosine_ops);

-- Sanity EXPLAIN for time-window aggregates
EXPLAIN (ANALYZE, BUFFERS)
SELECT app_id, AVG(concurrent_players)
FROM player_counts
WHERE snapshot_time > now() - interval '30 days'
GROUP BY app_id;

-- Partitioning template (do not run until snapshot volume justifies it):
-- CREATE TABLE player_counts_partitioned (...) PARTITION BY RANGE (snapshot_time);
-- CREATE TABLE player_counts_2026_07 PARTITION OF ... FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
