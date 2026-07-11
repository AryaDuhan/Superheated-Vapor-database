import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import {
  isRealGameSql,
  NON_GAME_APP_IDS,
  toolTagsLower,
} from "@/lib/gameFilters";
import { IS_FREE_SQL } from "@/lib/isFree";

export const runtime = "nodejs";

/**
 * Curated Steam genres only (case-insensitive match on tags.tag_name).
 * Excludes vibe/meta tags: Trading, Fast-Paced, Lore-Rich, Competitive, etc.
 * Order = display preference when selecting the top panel categories.
 *
 * Spelling variants (e.g. Rogue-like / Rogue-lite) are listed once here and
 * expanded via CATEGORY_ALIASES so they share a single display box.
 */
const PREFERRED_GENRES = [
  "Horror",
  "Indie",
  "Adventure",
  "Metroidvania",
  "Action",
  "RPG",
  "Strategy",
  "Simulation",
  "Casual",
  "Puzzle",
  "Platformer",
  "Survival",
  "Roguelike",
  "Multiplayer",
  "Free to Play",
  "Early Access",
  "Sports",
  "Racing",
  "Shooter",
  "FPS",
  "Open World",
  "Sandbox",
  "JRPG",
  "MMORPG",
  "Visual Novel",
  "Fighting",
  "Stealth",
  "Action RPG",
  "Souls-like",
  "Survival Horror",
  "RTS",
  "Grand Strategy",
  "Turn-Based Strategy",
  "MOBA",
  "Battle Royale",
  "Hack and Slash",
  "Point & Click",
  "Dungeon Crawler",
  "Tower Defense",
  "Card Game",
  "City Builder",
  "Management",
  "Action-Adventure",
] as const;

/**
 * Steam tag variants → one display category.
 * Keys are PREFERRED_GENRES entries; values are all tag_name spellings to match.
 */
const CATEGORY_ALIASES: Record<string, readonly string[]> = {
  Roguelike: ["Roguelike", "Rogue-like", "Roguelite", "Rogue-lite"],
};

type CategoryRow = {
  tag_id: number;
  tag_name: string;
  num_games: string;
  avg_ccu: string;
};

type GameRow = {
  tag_name: string;
  app_id: number;
  name: string;
  concurrent_players: number;
  owners_estimate: string;
  is_free: boolean;
  rn: number | string;
};

type RankedGame = {
  app_id: number;
  name: string;
  concurrent_players: number;
  owners_estimate: string;
  is_free: boolean;
  rank: number;
};

/** All lowercase Steam tag names to match (includes alias spellings). */
function matchTagsLower(): string[] {
  const out: string[] = [];
  for (const g of PREFERRED_GENRES) {
    const aliases = CATEGORY_ALIASES[g];
    if (aliases) {
      for (const a of aliases) out.push(a.toLowerCase());
    } else {
      out.push(g.toLowerCase());
    }
  }
  return out;
}

/** Pref order keys = display names (canonical), lowercase. */
function displayPrefLower(): string[] {
  return PREFERRED_GENRES.map((g) => g.toLowerCase());
}

/** Flatten alias map to [aliasLower, displayName] pairs for SQL VALUES. */
function aliasPairs(): [string, string][] {
  const pairs: [string, string][] = [];
  for (const [display, aliases] of Object.entries(CATEGORY_ALIASES)) {
    for (const a of aliases) {
      pairs.push([a.toLowerCase(), display]);
    }
  }
  return pairs;
}

function aliasValuesClause(startParam: number, pairs: [string, string][]): string {
  if (pairs.length === 0) {
    return `(SELECT NULL::text AS alias, NULL::text AS display WHERE false)`;
  }
  return `(VALUES ${pairs
    .map(
      (_, i) =>
        `($${startParam + i * 2}::text, $${startParam + i * 2 + 1}::text)`,
    )
    .join(", ")}) AS v(alias, display)`;
}

function mapCategories(rows: CategoryRow[]) {
  return rows.map((c) => ({
    tag_id: c.tag_id,
    tag_name: c.tag_name,
    num_games: Number(c.num_games),
    avg_ccu: Number(c.avg_ccu) || 0,
  }));
}

function groupByTag(categories: CategoryRow[], ranked: GameRow[]) {
  const byTag: Record<string, RankedGame[]> = {};
  for (const c of categories) byTag[c.tag_name] = [];
  for (const g of ranked) {
    const list = byTag[g.tag_name];
    if (!list) continue;
    list.push({
      app_id: g.app_id,
      name: g.name,
      concurrent_players: Number(g.concurrent_players) || 0,
      owners_estimate: g.owners_estimate,
      is_free: !!g.is_free,
      rank: Number(g.rn) || list.length + 1,
    });
  }
  for (const key of Object.keys(byTag)) {
    byTag[key].sort((a, b) => a.rank - b.rank);
  }
  return byTag;
}

export async function GET() {
  try {
    const tagsLower = matchTagsLower();
    const prefLower = displayPrefLower();
    const pairs = aliasPairs();
    const aliasFlat = pairs.flat();
    const denyToolTags = toolTagsLower();
    const denyAppIds = [...NON_GAME_APP_IDS];

    // Param layout:
    // $1 = pref/display names, $2 = match tags, then alias pairs,
    // then tool-tag denylist, then non-game app ids
    const toolParamIdx = 3 + pairs.length * 2;
    const appIdsParamIdx = toolParamIdx + 1;
    const toolParam = `$${toolParamIdx}`;
    const appIdsParam = `$${appIdsParamIdx}`;
    const realGame = isRealGameSql({
      toolTagsParam: toolParam,
      appIdsParam,
    });
    const filterParams = [denyToolTags, denyAppIds] as const;
    const catParams = [prefLower, tagsLower, ...aliasFlat, ...filterParams];
    const aliasSql = aliasValuesClause(3, pairs);

    const preferredCte = `
      alias_map AS (
        SELECT * FROM ${aliasSql}
      ),
      preferred AS (
        SELECT
          t.tag_id,
          COALESCE(am.display, t.tag_name) AS tag_name,
          (
            SELECT MIN(ord)
            FROM unnest($1::text[]) WITH ORDINALITY AS u(name, ord)
            WHERE u.name = LOWER(COALESCE(am.display, t.tag_name))
          ) AS pref
        FROM tags t
        LEFT JOIN alias_map am ON am.alias = LOWER(t.tag_name)
        WHERE LOWER(t.tag_name) = ANY($2::text[])
      )
    `;

    const categories = await query<CategoryRow>(
      `
      WITH latest_ccu AS (
        SELECT DISTINCT ON (app_id)
          app_id, concurrent_players
        FROM player_counts
        ORDER BY app_id, snapshot_time DESC
      ),
      ${preferredCte},
      uniq AS (
        SELECT DISTINCT ON (p.tag_name, gt.app_id)
          p.tag_id,
          p.tag_name,
          p.pref,
          gt.app_id,
          lc.concurrent_players
        FROM preferred p
        JOIN game_tags gt ON gt.tag_id = p.tag_id
        JOIN games g ON g.app_id = gt.app_id
        JOIN latest_ccu lc ON lc.app_id = g.app_id
        WHERE ${realGame}
        ORDER BY p.tag_name, gt.app_id, lc.concurrent_players DESC NULLS LAST
      )
      SELECT
        MIN(u.tag_id) AS tag_id,
        u.tag_name,
        COUNT(*)::text AS num_games,
        ROUND(AVG(u.concurrent_players), 1)::text AS avg_ccu
      FROM uniq u
      GROUP BY u.tag_name, u.pref
      HAVING COUNT(*) >= 8
      ORDER BY u.pref NULLS LAST, AVG(u.concurrent_players) DESC NULLS LAST
      LIMIT 16
      `,
      catParams,
    );

    const freeCategories = await query<CategoryRow>(
      `
      WITH latest_ccu AS (
        SELECT DISTINCT ON (app_id)
          app_id, concurrent_players
        FROM player_counts
        ORDER BY app_id, snapshot_time DESC
      ),
      ${preferredCte},
      uniq AS (
        SELECT DISTINCT ON (p.tag_name, gt.app_id)
          p.tag_id,
          p.tag_name,
          p.pref,
          gt.app_id,
          lc.concurrent_players
        FROM preferred p
        JOIN game_tags gt ON gt.tag_id = p.tag_id
        JOIN games g ON g.app_id = gt.app_id
        JOIN latest_ccu lc ON lc.app_id = g.app_id
        WHERE ${IS_FREE_SQL}
          AND ${realGame}
        ORDER BY p.tag_name, gt.app_id, lc.concurrent_players DESC NULLS LAST
      )
      SELECT
        MIN(u.tag_id) AS tag_id,
        u.tag_name,
        COUNT(*)::text AS num_games,
        ROUND(AVG(u.concurrent_players), 1)::text AS avg_ccu
      FROM uniq u
      GROUP BY u.tag_name, u.pref
      HAVING COUNT(*) >= 5
      ORDER BY AVG(u.concurrent_players) DESC NULLS LAST, u.pref NULLS LAST
      LIMIT 8
      `,
      catParams,
    );

    const categoryNames = categories.map((c) => c.tag_name);
    const freeCategoryNames = freeCategories.map((c) => c.tag_name);

    // Ranked queries: $1 = display names, $2 = match tags, then alias pairs, filters
    const rankedAliasSql = aliasValuesClause(3, pairs);

    const rankedPreferredCte = `
      alias_map AS (
        SELECT * FROM ${rankedAliasSql}
      ),
      preferred AS (
        SELECT
          t.tag_id,
          COALESCE(am.display, t.tag_name) AS tag_name
        FROM tags t
        LEFT JOIN alias_map am ON am.alias = LOWER(t.tag_name)
        WHERE LOWER(t.tag_name) = ANY($2::text[])
      )
    `;

    const rankedParams = (names: string[]) => [
      names,
      tagsLower,
      ...aliasFlat,
      ...filterParams,
    ];

    const [ranked, rankedFree, topFree] = await Promise.all([
      categoryNames.length === 0
        ? Promise.resolve([] as GameRow[])
        : query<GameRow>(
            `
            WITH latest_ccu AS (
              SELECT DISTINCT ON (app_id)
                app_id, concurrent_players, owners_estimate
              FROM player_counts
              ORDER BY app_id, snapshot_time DESC
            ),
            ${rankedPreferredCte},
            deduped AS (
              SELECT DISTINCT ON (p.tag_name, g.app_id)
                p.tag_name,
                g.app_id,
                g.name,
                COALESCE(lc.concurrent_players, 0) AS concurrent_players,
                COALESCE(lc.owners_estimate, '0') AS owners_estimate,
                (${IS_FREE_SQL}) AS is_free
              FROM preferred p
              JOIN game_tags gt ON gt.tag_id = p.tag_id
              JOIN games g ON g.app_id = gt.app_id
              LEFT JOIN latest_ccu lc ON lc.app_id = g.app_id
              WHERE p.tag_name = ANY($1::text[])
                AND ${realGame}
              ORDER BY
                p.tag_name,
                g.app_id,
                COALESCE(lc.concurrent_players, 0) DESC
            ),
            ranked AS (
              SELECT
                tag_name,
                app_id,
                name,
                concurrent_players,
                owners_estimate,
                is_free,
                ROW_NUMBER() OVER (
                  PARTITION BY tag_name
                  ORDER BY concurrent_players DESC NULLS LAST, name
                ) AS rn
              FROM deduped
            )
            SELECT tag_name, app_id, name, concurrent_players, owners_estimate, is_free, rn
            FROM ranked
            WHERE rn <= 10
            ORDER BY tag_name, rn
            `,
            rankedParams(categoryNames),
          ),
      freeCategoryNames.length === 0
        ? Promise.resolve([] as GameRow[])
        : query<GameRow>(
            `
            WITH latest_ccu AS (
              SELECT DISTINCT ON (app_id)
                app_id, concurrent_players, owners_estimate
              FROM player_counts
              ORDER BY app_id, snapshot_time DESC
            ),
            ${rankedPreferredCte},
            deduped AS (
              SELECT DISTINCT ON (p.tag_name, g.app_id)
                p.tag_name,
                g.app_id,
                g.name,
                COALESCE(lc.concurrent_players, 0) AS concurrent_players,
                COALESCE(lc.owners_estimate, '0') AS owners_estimate,
                TRUE AS is_free
              FROM preferred p
              JOIN game_tags gt ON gt.tag_id = p.tag_id
              JOIN games g ON g.app_id = gt.app_id
              LEFT JOIN latest_ccu lc ON lc.app_id = g.app_id
              WHERE p.tag_name = ANY($1::text[])
                AND ${IS_FREE_SQL}
                AND ${realGame}
              ORDER BY
                p.tag_name,
                g.app_id,
                COALESCE(lc.concurrent_players, 0) DESC
            ),
            ranked AS (
              SELECT
                tag_name,
                app_id,
                name,
                concurrent_players,
                owners_estimate,
                is_free,
                ROW_NUMBER() OVER (
                  PARTITION BY tag_name
                  ORDER BY concurrent_players DESC NULLS LAST, name
                ) AS rn
              FROM deduped
            )
            SELECT tag_name, app_id, name, concurrent_players, owners_estimate, is_free, rn
            FROM ranked
            WHERE rn <= 10
            ORDER BY tag_name, rn
            `,
            rankedParams(freeCategoryNames),
          ),
      query<{
        app_id: number;
        name: string;
        concurrent_players: number;
        owners_estimate: string;
        rn: number | string;
      }>(
        `
        WITH latest_ccu AS (
          SELECT DISTINCT ON (app_id)
            app_id, concurrent_players, owners_estimate
          FROM player_counts
          ORDER BY app_id, snapshot_time DESC
        ),
        ranked AS (
          SELECT
            g.app_id,
            g.name,
            COALESCE(lc.concurrent_players, 0) AS concurrent_players,
            COALESCE(lc.owners_estimate, '0') AS owners_estimate,
            ROW_NUMBER() OVER (
              ORDER BY lc.concurrent_players DESC NULLS LAST, g.name
            ) AS rn
          FROM games g
          LEFT JOIN latest_ccu lc ON lc.app_id = g.app_id
          WHERE ${IS_FREE_SQL}
            AND ${isRealGameSql({ toolTagsParam: "$1", appIdsParam: "$2" })}
        )
        SELECT app_id, name, concurrent_players, owners_estimate, rn
        FROM ranked
        WHERE rn <= 10
        ORDER BY rn
        `,
        [denyToolTags, denyAppIds],
      ),
    ]);

    const topFreeMapped = topFree
      .map((g) => ({
        app_id: g.app_id,
        name: g.name,
        concurrent_players: Number(g.concurrent_players) || 0,
        owners_estimate: g.owners_estimate,
        is_free: true,
        rank: Number(g.rn) || 0,
      }))
      .sort((a, b) => a.rank - b.rank);

    return NextResponse.json(
      {
        categories: mapCategories(categories),
        byTag: groupByTag(categories, ranked),
        freeCategories: mapCategories(freeCategories),
        byTagFree: groupByTag(freeCategories, rankedFree),
        topFree: topFreeMapped,
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
        },
      },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
