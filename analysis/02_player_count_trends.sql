-- Phase 5: Time-series analysis on player_counts
-- Needs multiple snapshots per app for meaningful results (daily ingest / Phase 10).
-- Window functions: moving average, z-score spikes, day-over-day change.

-- Supporting indexes (also listed in Phase 9 of the guide)
CREATE INDEX IF NOT EXISTS idx_player_counts_snapshot_time
    ON player_counts (snapshot_time);
CREATE INDEX IF NOT EXISTS idx_player_counts_app_time
    ON player_counts (app_id, snapshot_time);

-- 1) 7-snapshot moving average of concurrent players (per game)
SELECT
    pc.app_id,
    g.name,
    pc.snapshot_time,
    pc.concurrent_players,
    ROUND(
        AVG(pc.concurrent_players) OVER (
            PARTITION BY pc.app_id
            ORDER BY pc.snapshot_time
            ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
        )::numeric,
        1
    ) AS moving_avg_7
FROM player_counts pc
JOIN games g ON g.app_id = pc.app_id
ORDER BY pc.app_id, pc.snapshot_time;

-- 2) Spike detection via z-score (|z| > 2)
WITH stats AS (
    SELECT
        app_id,
        snapshot_time,
        concurrent_players,
        AVG(concurrent_players) OVER (PARTITION BY app_id) AS mean_players,
        STDDEV(concurrent_players) OVER (PARTITION BY app_id) AS stddev_players
    FROM player_counts
)
SELECT
    s.app_id,
    g.name,
    s.snapshot_time,
    s.concurrent_players,
    ROUND(s.mean_players::numeric, 1) AS mean_players,
    ROUND(
        ((s.concurrent_players - s.mean_players) / NULLIF(s.stddev_players, 0))::numeric,
        2
    ) AS z_score
FROM stats s
JOIN games g ON g.app_id = s.app_id
WHERE ABS(
    (s.concurrent_players - s.mean_players) / NULLIF(s.stddev_players, 0)
) > 2
ORDER BY ABS(
    (s.concurrent_players - s.mean_players) / NULLIF(s.stddev_players, 0)
) DESC NULLS LAST;

-- 3) Snapshot-over-snapshot change (becomes day-over-day once daily ingest runs)
SELECT
    pc.app_id,
    g.name,
    pc.snapshot_time,
    pc.concurrent_players,
    pc.concurrent_players
        - LAG(pc.concurrent_players) OVER (
            PARTITION BY pc.app_id ORDER BY pc.snapshot_time
          ) AS change,
    ROUND(
        100.0 * (
            pc.concurrent_players
            - LAG(pc.concurrent_players) OVER (
                PARTITION BY pc.app_id ORDER BY pc.snapshot_time
              )
        ) / NULLIF(
            LAG(pc.concurrent_players) OVER (
                PARTITION BY pc.app_id ORDER BY pc.snapshot_time
            ),
            0
        ),
        1
    ) AS pct_change
FROM player_counts pc
JOIN games g ON g.app_id = pc.app_id
ORDER BY pc.app_id, pc.snapshot_time;

-- 4) Data-readiness check: how many snapshots per game?
SELECT
    COUNT(*) AS total_snapshots,
    COUNT(DISTINCT app_id) AS games_tracked,
    ROUND(AVG(n)::numeric, 2) AS avg_snapshots_per_game,
    MAX(n) AS max_snapshots_for_one_game
FROM (
    SELECT app_id, COUNT(*) AS n
    FROM player_counts
    GROUP BY app_id
) t;
