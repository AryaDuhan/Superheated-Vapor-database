"""Minimal check: genre parse + Wallpaper Engine membership shape."""
from insert_data import parse_genres

assert parse_genres("Action, Free To Play") == ["Action", "Free To Play"]
assert parse_genres("") == []
assert parse_genres(None) == []
assert parse_genres(
    "Casual, Indie, Animation & Modeling, Design & Illustration, Photo Editing, Utilities"
) == [
    "Casual",
    "Indie",
    "Animation & Modeling",
    "Design & Illustration",
    "Photo Editing",
    "Utilities",
]
print("parse_genres ok")
