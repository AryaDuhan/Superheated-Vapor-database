/**
 * Filters for Steam tag pollution: non-game software, tools, adult junk.
 * Schema has no app `type` — rely on tags + known app ids + name patterns.
 */

/** Steam store / SteamSpy software & tool tags — exclude apps that carry any of these. */
export const TOOL_TAG_DENYLIST = [
  "Software",
  "Utilities",
  "Animation & Modeling",
  "Design & Illustration",
  "Video Production",
  "Web Publishing",
  "Education",
  "Accounting",
  "Photo Editing",
  "Audio Production",
  "Game Development",
] as const;

/** Tags that should never appear as busy-niche / tag-gap rows. */
export const NON_GAME_TAG_DENYLIST = [
  ...TOOL_TAG_DENYLIST,
  "NSFW",
  "Sexual Content",
  "Nudity",
  "Hentai",
  "Documentary",
  "Short",
  "Movie",
  "Episodic",
  "Tutorial",
] as const;

/** Known non-game Steam appids. */
export const NON_GAME_APP_IDS = [
  431960, // Wallpaper Engine
  365670, // Blender
] as const;

export function toolTagsLower(): string[] {
  return TOOL_TAG_DENYLIST.map((t) => t.toLowerCase());
}

export function nonGameTagsLower(): string[] {
  return NON_GAME_TAG_DENYLIST.map((t) => t.toLowerCase());
}

/**
 * SQL predicate: app is a real game candidate (not software/tool/junk).
 * Expects games alias `g`.
 */
export function isRealGameSql(opts: {
  toolTagsParam: string;
  appIdsParam: string;
}): string {
  const { toolTagsParam, appIdsParam } = opts;
  return `
(
  g.app_id <> ALL(${appIdsParam}::int[])
  AND g.name !~* '(^|[[:space:][:punct:]])(SDK|Soundtrack|Dedicated[[:space:]]+Server|Playtest)([[:space:][:punct:]]|$)'
  AND g.name !~* 'Wallpaper[[:space:]]+Engine'
  AND NOT EXISTS (
    SELECT 1
    FROM game_tags gt_deny
    JOIN tags t_deny ON t_deny.tag_id = gt_deny.tag_id
    WHERE gt_deny.app_id = g.app_id
      AND LOWER(t_deny.tag_name) = ANY(${toolTagsParam}::text[])
  )
)
`.trim();
}

/** Tag itself is not software/adult junk. Expects tags alias `t`. */
export function isGameRelevantTagSql(tagParam: string): string {
  return `LOWER(t.tag_name) <> ALL(${tagParam}::text[])`;
}
