-- Phase 7: Publisher / studio hierarchy (recursive CTE)
-- Seed known parent relationships, then walk the tree.

-- Parents (create if missing so seed UPDATEs always have a target)
INSERT INTO developers (name) VALUES
    ('Activision Blizzard'),
    ('Electronic Arts'),
    ('Ubisoft'),
    ('Xbox Game Studios'),
    ('Take-Two Interactive'),
    ('Embracer Group'),
    ('Sony Interactive Entertainment')
ON CONFLICT (name) DO NOTHING;

-- Children → parents (only updates rows that exist)
UPDATE developers SET parent_dev_id = (SELECT dev_id FROM developers WHERE name = 'Activision Blizzard')
WHERE name IN ('Infinity Ward', 'Treyarch', 'Blizzard Entertainment', 'Activision', 'Beenox', 'Sledgehammer Games')
  AND parent_dev_id IS NULL;

UPDATE developers SET parent_dev_id = (SELECT dev_id FROM developers WHERE name = 'Electronic Arts')
WHERE name IN ('EA DICE', 'DICE', 'BioWare', 'Respawn Entertainment', 'Criterion Games', 'PopCap Games')
  AND parent_dev_id IS NULL;

UPDATE developers SET parent_dev_id = (SELECT dev_id FROM developers WHERE name = 'Ubisoft')
WHERE name IN (
    'Ubisoft Montreal', 'Ubisoft Toronto', 'Ubisoft Paris',
    'Ubisoft Quebec', 'Ubisoft Bordeaux', 'Ubisoft Sofia', 'Massive Entertainment'
)
  AND parent_dev_id IS NULL;

UPDATE developers SET parent_dev_id = (SELECT dev_id FROM developers WHERE name = 'Xbox Game Studios')
WHERE name IN ('Bethesda Softworks', 'id Software', 'Playground Games', 'Ninja Theory', 'Obsidian Entertainment', 'Double Fine Productions')
  AND parent_dev_id IS NULL;

UPDATE developers SET parent_dev_id = (SELECT dev_id FROM developers WHERE name = 'Take-Two Interactive')
WHERE name IN ('Rockstar Games', 'Rockstar North', '2K', '2K Games', 'Hangar 13', 'Visual Concepts')
  AND parent_dev_id IS NULL;

-- Recursive studio tree with game counts
WITH RECURSIVE dev_tree AS (
    SELECT
        dev_id,
        name,
        parent_dev_id,
        name::TEXT AS path,
        0 AS depth
    FROM developers
    WHERE parent_dev_id IS NULL

    UNION ALL

    SELECT
        d.dev_id,
        d.name,
        d.parent_dev_id,
        dt.path || ' > ' || d.name,
        dt.depth + 1
    FROM developers d
    JOIN dev_tree dt ON d.parent_dev_id = dt.dev_id
)
SELECT
    dt.path,
    dt.depth,
    COUNT(g.app_id) AS game_count
FROM dev_tree dt
LEFT JOIN games g ON g.dev_id = dt.dev_id
GROUP BY dt.path, dt.depth
ORDER BY dt.path;

-- Only studios that have a hierarchy (depth > 0 or are parents)
WITH RECURSIVE linked AS (
    SELECT dev_id, name, parent_dev_id, name::TEXT AS path, 0 AS depth
    FROM developers
    WHERE parent_dev_id IS NULL
      AND dev_id IN (SELECT DISTINCT parent_dev_id FROM developers WHERE parent_dev_id IS NOT NULL)

    UNION ALL

    SELECT d.dev_id, d.name, d.parent_dev_id, l.path || ' > ' || d.name, l.depth + 1
    FROM developers d
    JOIN linked l ON d.parent_dev_id = l.dev_id
)
SELECT path, depth, COUNT(g.app_id) AS game_count
FROM linked l
LEFT JOIN games g ON g.dev_id = l.dev_id
GROUP BY path, depth
ORDER BY path;
