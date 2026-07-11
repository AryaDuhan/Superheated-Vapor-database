-- Phase 6: Tag co-occurrence & market gap analysis
-- Answers: which tags travel together, and which niches are crowded vs underserved?

-- 1) Top tag pairs that appear on the same games
-- Self-join game_tags with tag_id < tag_id so each unordered pair is counted once
SELECT
    t1.tag_name AS tag_a,
    t2.tag_name AS tag_b,
    COUNT(*) AS co_occurrences
FROM game_tags gt1
JOIN game_tags gt2
  ON gt1.app_id = gt2.app_id
 AND gt1.tag_id < gt2.tag_id
JOIN tags t1 ON gt1.tag_id = t1.tag_id
JOIN tags t2 ON gt2.tag_id = t2.tag_id
GROUP BY t1.tag_name, t2.tag_name
ORDER BY co_occurrences DESC
LIMIT 20;

-- 2) Market gap: high average CCU per game, relatively few titles with the tag
-- supply = how many games have the tag
-- demand = average concurrent players across those games' latest snapshots
-- Excludes software/tool apps and non-game niche tags (Software, Utilities, NSFW, …)
WITH latest_ccu AS (
    SELECT DISTINCT ON (app_id)
        app_id,
        concurrent_players
    FROM player_counts
    ORDER BY app_id, snapshot_time DESC
),
tool_tags AS (
    SELECT unnest(ARRAY[
        'software', 'utilities', 'animation & modeling', 'design & illustration',
        'video production', 'web publishing', 'education', 'accounting',
        'photo editing', 'audio production', 'game development'
    ]::text[]) AS tag_name
),
non_game_tags AS (
    SELECT tag_name FROM tool_tags
    UNION ALL
    SELECT unnest(ARRAY[
        'nsfw', 'sexual content', 'nudity', 'hentai',
        'documentary', 'short', 'movie', 'episodic', 'tutorial'
    ]::text[])
),
real_games AS (
    SELECT g.app_id
    FROM games g
    WHERE g.app_id NOT IN (431960, 365670)  -- Wallpaper Engine, Blender
      AND g.name !~* '(^|[[:space:][:punct:]])(SDK|Soundtrack|Dedicated[[:space:]]+Server|Playtest)([[:space:][:punct:]]|$)'
      AND g.name !~* 'Wallpaper[[:space:]]+Engine'
      AND NOT EXISTS (
          SELECT 1
          FROM game_tags gt
          JOIN tags t ON t.tag_id = gt.tag_id
          JOIN tool_tags tt ON tt.tag_name = LOWER(t.tag_name)
          WHERE gt.app_id = g.app_id
      )
),
tag_supply AS (
    SELECT gt.tag_id, COUNT(*) AS num_games
    FROM game_tags gt
    JOIN real_games rg ON rg.app_id = gt.app_id
    GROUP BY gt.tag_id
),
tag_demand AS (
    SELECT
        gt.tag_id,
        AVG(lc.concurrent_players)::numeric AS avg_players
    FROM game_tags gt
    JOIN real_games rg ON rg.app_id = gt.app_id
    JOIN latest_ccu lc ON lc.app_id = gt.app_id
    GROUP BY gt.tag_id
)
SELECT
    t.tag_name,
    s.num_games,
    ROUND(d.avg_players, 1) AS avg_players,
    ROUND(d.avg_players / NULLIF(s.num_games, 0), 1) AS demand_per_supply_ratio
FROM tag_supply s
JOIN tag_demand d ON d.tag_id = s.tag_id
JOIN tags t ON t.tag_id = s.tag_id
WHERE s.num_games BETWEEN 5 AND 100   -- ignore ultra-rare noise and mega-genres
  AND LOWER(t.tag_name) NOT IN (SELECT tag_name FROM non_game_tags)
ORDER BY demand_per_supply_ratio DESC
LIMIT 20;

-- 3) Most common tags overall (context for co-occurrence)
SELECT
    t.tag_name,
    COUNT(*) AS game_count
FROM game_tags gt
JOIN tags t ON t.tag_id = gt.tag_id
GROUP BY t.tag_name
ORDER BY game_count DESC
LIMIT 20;

-- 4) Lift-style view: co-occurrence rate vs independent frequency (top pairs)
-- Higher lift => tags appear together more than chance would suggest
WITH tag_freq AS (
    SELECT tag_id, COUNT(*)::numeric AS n
    FROM game_tags
    GROUP BY tag_id
),
total_games AS (
    SELECT COUNT(DISTINCT app_id)::numeric AS n FROM game_tags
),
pairs AS (
    SELECT
        gt1.tag_id AS tag_a_id,
        gt2.tag_id AS tag_b_id,
        COUNT(*)::numeric AS together
    FROM game_tags gt1
    JOIN game_tags gt2
      ON gt1.app_id = gt2.app_id
     AND gt1.tag_id < gt2.tag_id
    GROUP BY gt1.tag_id, gt2.tag_id
)
SELECT
    ta.tag_name AS tag_a,
    tb.tag_name AS tag_b,
    p.together::int AS co_occurrences,
    ROUND(
        p.together / NULLIF((fa.n * fb.n) / tg.n, 0),
        2
    ) AS lift
FROM pairs p
JOIN tag_freq fa ON fa.tag_id = p.tag_a_id
JOIN tag_freq fb ON fb.tag_id = p.tag_b_id
JOIN tags ta ON ta.tag_id = p.tag_a_id
JOIN tags tb ON tb.tag_id = p.tag_b_id
CROSS JOIN total_games tg
WHERE p.together >= 30
ORDER BY lift DESC, p.together DESC
LIMIT 20;
