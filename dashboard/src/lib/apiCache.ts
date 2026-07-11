type Entry = { data: unknown; at: number; promise?: Promise<unknown> };

const store = new Map<string, Entry>();
const TTL_MS = 90_000;

function fresh(hit: Entry | undefined): boolean {
  return !!hit && Date.now() - hit.at < TTL_MS && hit.data !== undefined;
}

/** Sync read for instant paint when revisiting a page (stale OK). */
export function peekCache<T>(url: string): T | null {
  const hit = store.get(url);
  return hit?.data !== undefined ? (hit.data as T) : null;
}

export async function cachedGet<T>(url: string): Promise<T> {
  const hit = store.get(url);
  if (fresh(hit) && !hit!.promise) return hit!.data as T;
  if (hit?.promise) return hit.promise as Promise<T>;

  const promise = fetch(url)
    .then(async (r) => {
      const data = await r.json();
      store.set(url, { data, at: Date.now() });
      return data;
    })
    .catch((err) => {
      // Keep last good payload if a refresh fails
      if (hit?.data !== undefined) {
        store.set(url, { data: hit.data, at: hit.at });
        return hit.data;
      }
      store.delete(url);
      throw err;
    });

  store.set(url, { data: hit?.data, at: hit?.at ?? 0, promise });
  return promise as Promise<T>;
}

/** Fire-and-forget warm so the next page visit is instant. */
export function prefetchGet(url: string): void {
  void cachedGet(url);
}

export const API_ROUTES = {
  "/": "/api/stats",
  "/top": "/api/top?sort=ccu&limit=50&price=all&category=All&minCcu=0",
  "/analysis": "/api/analysis",
  "/market": "/api/market",
  "/sentiment": "/api/sentiment",
  "/signals": "/api/signals",
} as const;

/** Extra warm targets when hovering Store (home pulls multiple payloads). */
export const HOME_EXTRA = [
  "/api/top-by-category",
  "/api/sentiment",
] as const;
