-- Phase 4: SCD Type 2 price history
-- Tracks every price change as a closed historical row + one open current row.
-- currency_code is included so USD/EUR/etc. version independently.

CREATE OR REPLACE FUNCTION upsert_price(
    p_app_id INT,
    p_price NUMERIC,
    p_discount INT,
    p_currency VARCHAR(3) DEFAULT 'USD'
)
RETURNS VOID AS $$
BEGIN
    -- Close the current version only when price or discount actually changed
    UPDATE price_history
    SET valid_to = now(),
        is_current = FALSE
    WHERE app_id = p_app_id
      AND currency_code = p_currency
      AND is_current = TRUE
      AND (
          price IS DISTINCT FROM p_price
          OR discount_pct IS DISTINCT FROM p_discount
      );

    -- Open a new current version if none exists for this exact price state
    INSERT INTO price_history (
        app_id, currency_code, price, discount_pct,
        valid_from, valid_to, is_current
    )
    SELECT p_app_id, p_currency, p_price, p_discount, now(), NULL, TRUE
    WHERE NOT EXISTS (
        SELECT 1
        FROM price_history
        WHERE app_id = p_app_id
          AND currency_code = p_currency
          AND is_current = TRUE
          AND price IS NOT DISTINCT FROM p_price
          AND discount_pct IS NOT DISTINCT FROM p_discount
    );
END;
$$ LANGUAGE plpgsql;

-- Enforce at most one current row per game + currency
CREATE UNIQUE INDEX IF NOT EXISTS uq_price_history_one_current
ON price_history (app_id, currency_code)
WHERE is_current = TRUE;
