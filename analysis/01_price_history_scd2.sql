-- Phase 4 analysis queries — SCD Type 2 price history

-- 1) Point-in-time price lookup (what was CS2 priced at on a given day?)
SELECT app_id, currency_code, price, discount_pct, valid_from, valid_to, is_current
FROM price_history
WHERE app_id = 730
  AND currency_code = 'USD'
  AND valid_from <= TIMESTAMPTZ '2026-07-11'
  AND (valid_to IS NULL OR valid_to > TIMESTAMPTZ '2026-07-11')
ORDER BY valid_from DESC
LIMIT 1;

-- 2) Current prices only
SELECT g.app_id, g.name, ph.price, ph.discount_pct
FROM price_history ph
JOIN games g ON g.app_id = ph.app_id
WHERE ph.is_current = TRUE
  AND ph.currency_code = 'USD'
ORDER BY ph.discount_pct DESC NULLS LAST
LIMIT 20;

-- 3) Discount frequency (needs multiple versions from future snapshots)
SELECT
    ph.app_id,
    g.name,
    COUNT(*) FILTER (WHERE ph.discount_pct > 0) AS times_discounted,
    ROUND(AVG(ph.discount_pct) FILTER (WHERE ph.discount_pct > 0), 1) AS avg_discount
FROM price_history ph
JOIN games g ON g.app_id = ph.app_id
GROUP BY ph.app_id, g.name
ORDER BY times_discounted DESC, avg_discount DESC NULLS LAST
LIMIT 20;

-- 4) Full version history for one game (shows SCD2 closing/opening rows)
SELECT price_id, price, discount_pct, valid_from, valid_to, is_current
FROM price_history
WHERE app_id = 730
  AND currency_code = 'USD'
ORDER BY valid_from;
