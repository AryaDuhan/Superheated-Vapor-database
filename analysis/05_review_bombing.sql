-- Phase 8: Review bombing detection
-- Flag days where negative reviews spike vs a game's own baseline (z-score > 3).

WITH daily_reviews AS (
    SELECT
        app_id,
        DATE_TRUNC('day', review_time) AS review_day,
        COUNT(*) FILTER (WHERE is_positive = FALSE) AS negative_count,
        COUNT(*) FILTER (WHERE is_positive = TRUE) AS positive_count,
        COUNT(*) AS total_count
    FROM reviews
    GROUP BY app_id, DATE_TRUNC('day', review_time)
),
with_stats AS (
    SELECT
        *,
        AVG(negative_count) OVER (PARTITION BY app_id) AS avg_neg,
        STDDEV(negative_count) OVER (PARTITION BY app_id) AS stddev_neg
    FROM daily_reviews
)
SELECT
    w.app_id,
    g.name,
    w.review_day,
    w.negative_count,
    w.positive_count,
    w.total_count,
    ROUND((100.0 * w.negative_count / NULLIF(w.total_count, 0))::numeric, 1) AS neg_pct,
    ROUND(
        ((w.negative_count - w.avg_neg) / NULLIF(w.stddev_neg, 0))::numeric,
        2
    ) AS z_score
FROM with_stats w
JOIN games g ON g.app_id = w.app_id
WHERE (w.negative_count - w.avg_neg) / NULLIF(w.stddev_neg, 0) > 3
ORDER BY z_score DESC
LIMIT 50;

-- Softer threshold for sparse data (z > 2), useful while review volume is still growing
WITH daily_reviews AS (
    SELECT
        app_id,
        DATE_TRUNC('day', review_time) AS review_day,
        COUNT(*) FILTER (WHERE is_positive = FALSE) AS negative_count,
        COUNT(*) AS total_count
    FROM reviews
    GROUP BY app_id, DATE_TRUNC('day', review_time)
    HAVING COUNT(*) >= 5
),
with_stats AS (
    SELECT
        *,
        AVG(negative_count) OVER (PARTITION BY app_id) AS avg_neg,
        STDDEV(negative_count) OVER (PARTITION BY app_id) AS stddev_neg
    FROM daily_reviews
)
SELECT
    w.app_id,
    g.name,
    w.review_day::date AS review_day,
    w.negative_count,
    w.total_count,
    ROUND(
        ((w.negative_count - w.avg_neg) / NULLIF(w.stddev_neg, 0))::numeric,
        2
    ) AS z_score
FROM with_stats w
JOIN games g ON g.app_id = w.app_id
WHERE ABS((w.negative_count - w.avg_neg) / NULLIF(w.stddev_neg, 0)) > 2
ORDER BY z_score DESC
LIMIT 30;
