-- SteamSpy official store genres (comma-separated `genre` on appdetails).
-- Multi-membership: a game can belong to every genre listed (same pattern as tags).

CREATE TABLE IF NOT EXISTS genres (
    genre_id SERIAL PRIMARY KEY,
    genre_name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS game_genres (
    app_id INT REFERENCES games(app_id),
    genre_id INT REFERENCES genres(genre_id),
    PRIMARY KEY (app_id, genre_id)
);

CREATE INDEX IF NOT EXISTS idx_game_genres_genre_id ON game_genres(genre_id);
