-- Phase 8 companion already in 05_review_bombing.sql
-- Phase 9 companion: sql/09_indexing.sql
-- This file documents EXPLAIN usage for the README / portfolio.

EXPLAIN (ANALYZE, BUFFERS)
SELECT app_id, AVG(concurrent_players)
FROM player_counts
WHERE snapshot_time > now() - interval '30 days'
GROUP BY app_id;
