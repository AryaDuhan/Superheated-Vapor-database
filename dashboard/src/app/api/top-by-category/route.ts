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
 * Broad Store / SteamSpy genres — matched against `genres.genre_name`.
 * Multi-membership: a game appears in every genre SteamSpy listed.
 * Spelling matches SteamSpy (`Free To Play`, not tag-style `Free to Play`).
 */
const OFFICIAL_GENRES = [
  "Action",
  "Indie",
  "Adventure",
  "RPG",
  "Strategy",
  "Simulation",
  "Casual",
  "Sports",
  "Racing",
  "Massively Multiplayer",
  "Free To Play",
  "Early Access",
] as const;

/**
 * Niches that are Steam *tags*, not SteamSpy store genres.
 * Keep tag denylist / pollution filters for these.
 */
const NICHE_TAGS = [
  "Horror",
  "Metroidvania",
  "Roguelike",
  "Souls-like",
  "Puzzle",
  "Platformer",
  "Survival",
  "Multiplayer",
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

/** Display preference order (official first, then niches). */
const DISPLAY_ORDER = [...OFFICIAL_GENRES, ...NICHE_TAGS] as const;

const TAG_ALIASES: Record<string, readonly string[]> = {
  Roguelike: ["Roguelike", "Rogue-like", "Roguelite", "Rogue-lite"],
};

type CategoryRow = {
  tag_id: number;
  tag_name: string;
  num_games: string;
  avg_ccu: string;
  source: string;
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

function nicheMatchLower(): string[] {
  const out: string[] = [];
  for (const g of NICHE_TAGS) {
    const aliases = TAG_ALIASES[g];
    if (aliases) {
      for (const a of aliases) out.push(a.toLowerCase());
    } else {
      out.push(g.toLowerCase());
    }
  }
  return out;
}

function aliasPairs(): [string, string][] {
  const pairs: [string, string][] = [];
  for (const [display, aliases] of Object.entries(TAG_ALIASES)) {
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
    source: c.source,
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

function pickTopCategories(
  rows: CategoryRow[],
  limit: number,
  minGames: number,
): CategoryRow[] {
  const pref = new Map(
    DISPLAY_ORDER.map((name, i) => [name.toLowerCase(), i]),
  );
  return [...rows]
    .filter((r) => Number(r.num_games) >= minGames)
    .sort((a, b) => {
      const pa = pref.get(a.tag_name.toLowerCase()) ?? 999;
      const pb = pref.get(b.tag_name.toLowerCase()) ?? 999;
      if (pa !== pb) return pa - pb;
      return (Number(b.avg_ccu) || 0) - (Number(a.avg_ccu) || 0);
    })
    .slice(0, limit);
}

export async function GET() {
  try {
    const officialLower = OFFICIAL_GENRES.map((g) => g.toLowerCase());
    const nicheLower = nicheMatchLower();
    const pairs = aliasPairs();
    const aliasFlat = pairs.flat();
    const denyToolTags = toolTagsLower();
    const denyAppIds = [...NON_GAME_APP_IDS];

    const realGame = isRealGameSql({
      toolTagsParam: "$2",
      appIdsParam: "$3",
    });
    const genreCatParams = [officialLower, denyToolTags, denyAppIds] as const;

    // Niche tags: $1=pref display order keys, $2=match tags, aliases…, filters
    const nicheToolIdx = 3 + pairs.length * 2;
    const nicheAppIdx = nicheToolIdx + 1;
    const nicheRealGame = isRealGameSql({
      toolTagsParam: `$${nicheToolIdx}`,
      appIdsParam: `$${nicheAppIdx}`,
    });
    const nichePrefLower = NICHE_TAGS.map((g) => g.toLowerCase());
    const nicheCatParams = [
      nichePrefLower,
      nicheLower,
      ...aliasFlat,
      denyToolTags,
      denyAppIds,
    ];
    const aliasSql = aliasValuesClause(3, pairs);

    const preferredNicheCte = `
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

    const [genreCats, nicheCats, genreFreeCats, nicheFreeCats] =
      await Promise.all([
        query<CategoryRow>(
          `
          WITH latest_ccu AS (
            SELECT DISTINCT ON (app_id)
              app_id, concurrent_players
            FROM player_counts
            ORDER BY app_id, snapshot_time DESC
          ),
          preferred AS (
            SELECT
              gen.genre_id AS tag_id,
              gen.genre_name AS tag_name,
              (
                SELECT MIN(ord)
                FROM unnest($1::text[]) WITH ORDINALITY AS u(name, ord)
                WHERE u.name = LOWER(gen.genre_name)
              ) AS pref
            FROM genres gen
            WHERE LOWER(gen.genre_name) = ANY($1::text[])
          ),
          uniq AS (
            SELECT DISTINCT ON (p.tag_name, gg.app_id)
              p.tag_id,
              p.tag_name,
              p.pref,
              gg.app_id,
              lc.concurrent_players
            FROM preferred p
            JOIN game_genres gg ON gg.genre_id = p.tag_id
            JOIN games g ON g.app_id = gg.app_id
            JOIN latest_ccu lc ON lc.app_id = g.app_id
            WHERE ${realGame}
            ORDER BY p.tag_name, gg.app_id, lc.concurrent_players DESC NULLS LAST
          )
          SELECT
            MIN(u.tag_id) AS tag_id,
            u.tag_name,
            COUNT(*)::text AS num_games,
            ROUND(AVG(u.concurrent_players), 1)::text AS avg_ccu,
            'genre'::text AS source
          FROM uniq u
          GROUP BY u.tag_name, u.pref
          ORDER BY u.pref NULLS LAST, AVG(u.concurrent_players) DESC NULLS LAST
          `,
          [...genreCatParams],
        ),
        query<CategoryRow>(
          `
          WITH latest_ccu AS (
            SELECT DISTINCT ON (app_id)
              app_id, concurrent_players
            FROM player_counts
            ORDER BY app_id, snapshot_time DESC
          ),
          ${preferredNicheCte},
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
            WHERE ${nicheRealGame}
            ORDER BY p.tag_name, gt.app_id, lc.concurrent_players DESC NULLS LAST
          )
          SELECT
            MIN(u.tag_id) AS tag_id,
            u.tag_name,
            COUNT(*)::text AS num_games,
            ROUND(AVG(u.concurrent_players), 1)::text AS avg_ccu,
            'tag'::text AS source
          FROM uniq u
          GROUP BY u.tag_name, u.pref
          ORDER BY u.pref NULLS LAST, AVG(u.concurrent_players) DESC NULLS LAST
          `,
          nicheCatParams,
        ),
        query<CategoryRow>(
          `
          WITH latest_ccu AS (
            SELECT DISTINCT ON (app_id)
              app_id, concurrent_players
            FROM player_counts
            ORDER BY app_id, snapshot_time DESC
          ),
          preferred AS (
            SELECT
              gen.genre_id AS tag_id,
              gen.genre_name AS tag_name
            FROM genres gen
            WHERE LOWER(gen.genre_name) = ANY($1::text[])
          ),
          uniq AS (
            SELECT DISTINCT ON (p.tag_name, gg.app_id)
              p.tag_id,
              p.tag_name,
              gg.app_id,
              lc.concurrent_players
            FROM preferred p
            JOIN game_genres gg ON gg.genre_id = p.tag_id
            JOIN games g ON g.app_id = gg.app_id
            JOIN latest_ccu lc ON lc.app_id = g.app_id
            WHERE ${IS_FREE_SQL}
              AND ${realGame}
            ORDER BY p.tag_name, gg.app_id, lc.concurrent_players DESC NULLS LAST
          )
          SELECT
            MIN(u.tag_id) AS tag_id,
            u.tag_name,
            COUNT(*)::text AS num_games,
            ROUND(AVG(u.concurrent_players), 1)::text AS avg_ccu,
            'genre'::text AS source
          FROM uniq u
          GROUP BY u.tag_name
          ORDER BY AVG(u.concurrent_players) DESC NULLS LAST
          `,
          [...genreCatParams],
        ),
        query<CategoryRow>(
          `
          WITH latest_ccu AS (
            SELECT DISTINCT ON (app_id)
              app_id, concurrent_players
            FROM player_counts
            ORDER BY app_id, snapshot_time DESC
          ),
          ${preferredNicheCte},
          uniq AS (
            SELECT DISTINCT ON (p.tag_name, gt.app_id)
              p.tag_id,
              p.tag_name,
              gt.app_id,
              lc.concurrent_players
            FROM preferred p
            JOIN game_tags gt ON gt.tag_id = p.tag_id
            JOIN games g ON g.app_id = gt.app_id
            JOIN latest_ccu lc ON lc.app_id = g.app_id
            WHERE ${IS_FREE_SQL}
              AND ${nicheRealGame}
            ORDER BY p.tag_name, gt.app_id, lc.concurrent_players DESC NULLS LAST
          )
          SELECT
            MIN(u.tag_id) AS tag_id,
            u.tag_name,
            COUNT(*)::text AS num_games,
            ROUND(AVG(u.concurrent_players), 1)::text AS avg_ccu,
            'tag'::text AS source
          FROM uniq u
          GROUP BY u.tag_name
          ORDER BY AVG(u.concurrent_players) DESC NULLS LAST
          `,
          nicheCatParams,
        ),
      ]);

    // Prefer official genres; fill remaining slots with niche tags.
    // Genre min can be lower while catalog is still filling from SteamSpy.
    const categories = [
      ...pickTopCategories(genreCats, 10, 3),
      ...pickTopCategories(nicheCats, 16, 8),
    ].slice(0, 16);

    const freeCategories = [
      ...pickTopCategories(genreFreeCats, 5, 2),
      ...pickTopCategories(nicheFreeCats, 8, 5),
    ].slice(0, 8);

    const categoryNames = categories.map((c) => c.tag_name);
    const freeCategoryNames = freeCategories.map((c) => c.tag_name);
    const genreDisplayNames = new Set(
      categories.filter((c) => c.source === "genre").map((c) => c.tag_name),
    );
    const freeGenreDisplayNames = new Set(
      freeCategories.filter((c) => c.source === "genre").map((c) => c.tag_name),
    );

    const rankedGenreNames = categoryNames.filter((n) =>
      genreDisplayNames.has(n),
    );
    const rankedNicheNames = categoryNames.filter(
      (n) => !genreDisplayNames.has(n),
    );
    const rankedFreeGenreNames = freeCategoryNames.filter((n) =>
      freeGenreDisplayNames.has(n),
    );
    const rankedFreeNicheNames = freeCategoryNames.filter(
      (n) => !freeGenreDisplayNames.has(n),
    );

    const rankedGenreReal = isRealGameSql({
      toolTagsParam: "$2",
      appIdsParam: "$3",
    });
    const rankedNicheToolIdx = 3 + pairs.length * 2;
    const rankedNicheAppIdx = rankedNicheToolIdx + 1;
    const rankedNicheReal = isRealGameSql({
      toolTagsParam: `$${rankedNicheToolIdx}`,
      appIdsParam: `$${rankedNicheAppIdx}`,
    });
    const rankedAliasSql = aliasValuesClause(3, pairs);
    const rankedNichePreferredCte = `
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

    async function rankedByGenre(names: string[], freeOnly: boolean) {
      if (names.length === 0) return [] as GameRow[];
      return query<GameRow>(
        `
        WITH latest_ccu AS (
          SELECT DISTINCT ON (app_id)
            app_id, concurrent_players, owners_estimate
          FROM player_counts
          ORDER BY app_id, snapshot_time DESC
        ),
        preferred AS (
          SELECT gen.genre_id AS tag_id, gen.genre_name AS tag_name
          FROM genres gen
          WHERE gen.genre_name = ANY($1::text[])
        ),
        deduped AS (
          SELECT DISTINCT ON (p.tag_name, g.app_id)
            p.tag_name,
            g.app_id,
            g.name,
            COALESCE(lc.concurrent_players, 0) AS concurrent_players,
            COALESCE(lc.owners_estimate, '0') AS owners_estimate,
            (${IS_FREE_SQL}) AS is_free
          FROM preferred p
          JOIN game_genres gg ON gg.genre_id = p.tag_id
          JOIN games g ON g.app_id = gg.app_id
          LEFT JOIN latest_ccu lc ON lc.app_id = g.app_id
          WHERE ${freeOnly ? `${IS_FREE_SQL} AND` : ""} ${rankedGenreReal}
          ORDER BY
            p.tag_name,
            g.app_id,
            COALESCE(lc.concurrent_players, 0) DESC
        ),
        ranked AS (
          SELECT
            tag_name, app_id, name, concurrent_players, owners_estimate, is_free,
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
        [names, denyToolTags, denyAppIds],
      );
    }

    async function rankedByNiche(names: string[], freeOnly: boolean) {
      if (names.length === 0) return [] as GameRow[];
      return query<GameRow>(
        `
        WITH latest_ccu AS (
          SELECT DISTINCT ON (app_id)
            app_id, concurrent_players, owners_estimate
          FROM player_counts
          ORDER BY app_id, snapshot_time DESC
        ),
        ${rankedNichePreferredCte},
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
            ${freeOnly ? `AND ${IS_FREE_SQL}` : ""}
            AND ${rankedNicheReal}
          ORDER BY
            p.tag_name,
            g.app_id,
            COALESCE(lc.concurrent_players, 0) DESC
        ),
        ranked AS (
          SELECT
            tag_name, app_id, name, concurrent_players, owners_estimate, is_free,
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
        [names, nicheLower, ...aliasFlat, denyToolTags, denyAppIds],
      );
    }

    const [rankedG, rankedN, rankedFreeG, rankedFreeN, topFree] =
      await Promise.all([
        rankedByGenre(rankedGenreNames, false),
        rankedByNiche(rankedNicheNames, false),
        rankedByGenre(rankedFreeGenreNames, true),
        rankedByNiche(rankedFreeNicheNames, true),
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
        byTag: groupByTag(categories, [...rankedG, ...rankedN]),
        freeCategories: mapCategories(freeCategories),
        byTagFree: groupByTag(freeCategories, [
          ...rankedFreeG,
          ...rankedFreeN,
        ]),
        topFree: topFreeMapped,
        meta: {
          // ponytail: multi-genre membership (game in each SteamSpy genre listed)
          membership: "multi",
          official_genres: OFFICIAL_GENRES,
          niche_tags: NICHE_TAGS,
        },
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
