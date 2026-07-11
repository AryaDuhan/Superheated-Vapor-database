"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  FormEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { API_ROUTES, HOME_EXTRA, prefetchGet } from "@/lib/apiCache";
import { formatCount, formatOwners } from "@/lib/format";

const LINKS = [
  { href: "/", label: "Store" },
  { href: "/top", label: "Top" },
  { href: "/analysis", label: "Analysis" },
  { href: "/sentiment", label: "Community" },
  { href: "/market", label: "Tags" },
  { href: "/signals", label: "Stats" },
] as const;

type GameHit = {
  app_id: number;
  name: string;
  concurrent_players: number;
  owners_estimate: string;
};

function warmFor(href: string) {
  const url = API_ROUTES[href as keyof typeof API_ROUTES];
  if (url) prefetchGet(url);
  if (href === "/") {
    for (const extra of HOME_EXTRA) prefetchGet(extra);
  }
}

export function SiteHeader() {
  const pathname = usePathname() || "/";
  const router = useRouter();
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [games, setGames] = useState<GameHit[]>([]);
  const [error, setError] = useState("");

  const runGameSearch = useCallback(async (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) {
      setGames([]);
      setError("");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        `/api/games/search?q=${encodeURIComponent(trimmed)}&limit=8`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Search failed");
      setGames(data.games ?? []);
      setOpen(true);
    } catch (err) {
      setGames([]);
      setError(err instanceof Error ? err.message : String(err));
      setOpen(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const trimmed = q.trim();
    if (!trimmed) {
      setGames([]);
      setError("");
      setLoading(false);
      return;
    }
    const t = window.setTimeout(() => {
      void runGameSearch(trimmed);
    }, 180);
    return () => window.clearTimeout(t);
  }, [q, runGameSearch]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = q.trim();
    if (!trimmed) return;
    void runGameSearch(trimmed);
    setOpen(true);
  }

  function goReviews() {
    const trimmed = q.trim();
    if (!trimmed) return;
    setOpen(false);
    router.push(`/search?q=${encodeURIComponent(trimmed)}`);
  }

  const showPanel = open && (q.trim().length > 0 || loading || !!error);

  return (
    <header className="site-header">
      <div className="brand-block">
        <Link href="/" className="brand" onMouseEnter={() => warmFor("/")}>
          Steamforge
        </Link>
        <p className="brand-sub">{"// Analytics"}</p>
      </div>
      <nav className="nav">
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            prefetch
            className={
              l.href === "/"
                ? pathname === "/" || pathname.startsWith("/game/")
                  ? "nav-link active"
                  : "nav-link"
                : pathname === l.href
                  ? "nav-link active"
                  : "nav-link"
            }
            onMouseEnter={() => warmFor(l.href)}
            onFocus={() => warmFor(l.href)}
          >
            {l.label}
          </Link>
        ))}
      </nav>

      <div className="header-search" ref={rootRef}>
        <form className="header-search-form" onSubmit={onSubmit} role="search">
          <input
            type="search"
            role="combobox"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
            }}
            onFocus={() => {
              if (q.trim()) setOpen(true);
            }}
            placeholder="Search games or reviews…"
            aria-autocomplete="list"
            aria-controls={listId}
            aria-expanded={showPanel}
            aria-haspopup="listbox"
            autoComplete="off"
            spellCheck={false}
          />
        </form>

        {showPanel && (
          <div className="header-search-panel framed" id={listId} role="listbox">
            <div className="header-search-panel-head">
              <span>Games</span>
              <span className="status">
                {loading
                  ? "Scanning…"
                  : games.length
                    ? `${games.length} hit${games.length === 1 ? "" : "s"}`
                    : "No matches"}
              </span>
            </div>

            {error && <p className="error header-search-msg">{error}</p>}

            {!loading && !error && games.length === 0 && (
              <p className="muted header-search-msg">No games matched that name.</p>
            )}

            <ul className="header-search-list">
              {games.map((g) => (
                <li key={g.app_id} role="option">
                  <Link
                    href={`/game/${g.app_id}`}
                    className="header-search-hit"
                    onClick={() => setOpen(false)}
                  >
                    <span className="header-search-hit-name">{g.name}</span>
                    <span className="header-search-hit-meta">
                      {formatCount(g.concurrent_players)} CCU ·{" "}
                      {formatOwners(g.owners_estimate)} owners
                    </span>
                  </Link>
                </li>
              ))}
            </ul>

            <button
              type="button"
              className="header-search-reviews"
              disabled={!q.trim()}
              onClick={goReviews}
            >
              Search reviews for “{q.trim() || "…"}”
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
