/**
 * Free classification (strict, price-first).
 *
 * - Any known USD store price > 0 → paid (F2P tag ignored).
 * - base_price_usd = 0 or current USD price = 0 → free.
 * - Only when both prices are unknown → fall back to "Free to Play" tag.
 *
 * SQL expects games row alias `g`.
 */
export const IS_FREE_SQL = `
(
  NOT (
    COALESCE(g.base_price_usd, 0) > 0
    OR EXISTS (
      SELECT 1 FROM price_history ph_paid
      WHERE ph_paid.app_id = g.app_id
        AND ph_paid.is_current
        AND ph_paid.currency_code = 'USD'
        AND COALESCE(ph_paid.price, 0) > 0
    )
  )
  AND (
    g.base_price_usd = 0
    OR EXISTS (
      SELECT 1 FROM price_history ph_zero
      WHERE ph_zero.app_id = g.app_id
        AND ph_zero.is_current
        AND ph_zero.currency_code = 'USD'
        AND ph_zero.price IS NOT NULL
        AND ph_zero.price = 0
    )
    OR (
      g.base_price_usd IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM price_history ph_any
        WHERE ph_any.app_id = g.app_id
          AND ph_any.is_current
          AND ph_any.currency_code = 'USD'
      )
      AND EXISTS (
        SELECT 1 FROM game_tags gt_f
        JOIN tags t_f ON t_f.tag_id = gt_f.tag_id
        WHERE gt_f.app_id = g.app_id AND t_f.tag_name = 'Free to Play'
      )
    )
  )
)
`;

export const FREE_DEFINITION =
  "Free games are titles with a $0 store price. A Free to Play tag alone does not count if the game costs money.";

export function isFreeGame(opts: {
  basePriceUsd: number | null | undefined;
  currentPriceUsd?: number | null | undefined;
  hasFreeToPlayTag?: boolean;
}): boolean {
  const base = opts.basePriceUsd;
  const cur = opts.currentPriceUsd;
  const hasPositive =
    (base != null && Number(base) > 0) || (cur != null && Number(cur) > 0);
  if (hasPositive) return false;
  if (base === 0 || cur === 0) return true;
  if (base == null && (cur == null || cur === undefined)) {
    return !!opts.hasFreeToPlayTag;
  }
  return false;
}
