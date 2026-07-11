DROP TABLE IF EXISTS reviews CASCADE;
DROP TABLE IF EXISTS player_counts CASCADE;
DROP TABLE IF EXISTS price_history CASCADE;
DROP TABLE IF EXISTS game_genres CASCADE;
DROP TABLE IF EXISTS genres CASCADE;
DROP TABLE IF EXISTS game_tags CASCADE;
DROP TABLE IF EXISTS tags CASCADE;
DROP TABLE IF EXISTS games CASCADE;
DROP TABLE IF EXISTS developers CASCADE;

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE developers (
    dev_id SERIAL PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    parent_dev_id INT REFERENCES developers(dev_id)
);
CREATE INDEX idx_developers_parent ON developers(parent_dev_id);

CREATE TABLE games (
    app_id INT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT, -- Added for future Semantic Search!
    release_date DATE,
    dev_id INT REFERENCES developers(dev_id),
    base_price_usd NUMERIC(10,2) -- Renamed to specify this is the default USD base price
);
CREATE INDEX idx_games_dev_id ON games(dev_id);

CREATE TABLE tags (
    tag_id SERIAL PRIMARY KEY,
    tag_name TEXT UNIQUE NOT NULL
);

CREATE TABLE game_tags (
    app_id INT REFERENCES games(app_id),
    tag_id INT REFERENCES tags(tag_id),
    PRIMARY KEY (app_id, tag_id)
);
-- Primary key handles (app_id, tag_id) lookups, but we need an index for reverse lookups (finding games by tag)
CREATE INDEX idx_game_tags_tag_id ON game_tags(tag_id);

-- SteamSpy store genres (multi-membership, same pattern as tags)
CREATE TABLE genres (
    genre_id SERIAL PRIMARY KEY,
    genre_name TEXT UNIQUE NOT NULL
);

CREATE TABLE game_genres (
    app_id INT REFERENCES games(app_id),
    genre_id INT REFERENCES genres(genre_id),
    PRIMARY KEY (app_id, genre_id)
);
CREATE INDEX idx_game_genres_genre_id ON game_genres(genre_id);

CREATE TABLE price_history (
    price_id SERIAL PRIMARY KEY,
    app_id INT REFERENCES games(app_id),
    currency_code VARCHAR(3) DEFAULT 'USD', -- Added for Localized Pricing (e.g., 'USD', 'EUR', 'TRY')
    price NUMERIC(10,2),
    discount_pct INT,
    valid_from TIMESTAMPTZ,
    valid_to TIMESTAMPTZ,
    is_current BOOLEAN DEFAULT TRUE
);
CREATE INDEX idx_price_history_app_curr_current ON price_history(app_id, currency_code, is_current);

CREATE TABLE player_counts (
    app_id INT REFERENCES games(app_id),
    snapshot_time TIMESTAMPTZ,
    concurrent_players INT,
    owners_estimate TEXT,
    PRIMARY KEY (app_id, snapshot_time)
);

CREATE TABLE reviews (
    review_id BIGINT PRIMARY KEY,
    app_id INT REFERENCES games(app_id),
    review_text TEXT, -- Sentiment Analysis & Semantic Search
    review_time TIMESTAMPTZ,
    is_positive BOOLEAN,
    playtime_at_review INT,
    review_embedding halfvec(384) -- all-MiniLM-L6-v2
);
CREATE INDEX idx_reviews_app_id ON reviews(app_id);
CREATE INDEX idx_reviews_embedding_hnsw
    ON reviews USING hnsw (review_embedding halfvec_cosine_ops);