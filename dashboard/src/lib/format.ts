/** Compact counts like 35.51m, 102.2k (lowercase suffixes). */

function parseNum(raw: string): number | null {
  const n = Number(raw.replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

function compact(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  const fmt = (v: number, suffix: string) => {
    const rounded =
      abs >= 100
        ? Math.round(v)
        : abs >= 10
          ? Math.round(v * 10) / 10
          : Math.round(v * 100) / 100;
    const s = Number.isInteger(rounded)
      ? String(rounded)
      : String(rounded).replace(/\.?0+$/, "");
    return `${sign}${s}${suffix}`;
  };
  if (abs >= 1_000_000_000) return fmt(abs / 1e9, "b");
  if (abs >= 1_000_000) return fmt(abs / 1e6, "m");
  if (abs >= 1_000) return fmt(abs / 1e3, "k");
  return n.toLocaleString();
}

/** SteamSpy owner bands like "10,000,000 .. 20,000,000" → "10m–20m". */
export function formatOwners(raw: string | null | undefined): string {
  if (!raw || raw === "0") return "—";

  const parts = raw.split(/\s*\.\.\s*/);
  if (parts.length === 2) {
    const lo = parseNum(parts[0]);
    const hi = parseNum(parts[1]);
    if (lo != null && hi != null) return `${compact(lo)}–${compact(hi)}`;
  }

  const single = parseNum(raw);
  if (single != null) return compact(single);
  return raw;
}

export function formatCount(raw: string | number | null | undefined): string {
  if (raw == null || raw === "") return "—";
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return String(raw);
  return compact(n);
}

/** Full locale count like 1,234 (no k/m). For Store catalog counters. */
export function formatFullCount(
  raw: string | number | null | undefined,
): string {
  if (raw == null || raw === "") return "—";
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return String(raw);
  return n.toLocaleString("en-US");
}

/** USD store price: `$29.99` / Free / —. */
export function formatUsd(
  n: number | null | undefined,
  opts?: { zeroAs?: "Free" | "$0" },
): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n === 0) return opts?.zeroAs ?? "Free";
  return `$${n.toFixed(2)}`;
}

/** INR store price with en-IN grouping: `₹2,499` / Free / —. */
export function formatInr(
  n: number | null | undefined,
  opts?: { zeroAs?: "Free" | "₹0" },
): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n === 0) return opts?.zeroAs ?? "Free";
  const rounded = Number.isInteger(n) ? n : Math.round(n * 100) / 100;
  return `₹${rounded.toLocaleString("en-IN", {
    maximumFractionDigits: Number.isInteger(rounded) ? 0 : 2,
    minimumFractionDigits: Number.isInteger(rounded) ? 0 : 2,
  })}`;
}

/**
 * Prefer both currencies when present: `$29.99 · ₹2,499`.
 * Free when the game is free or any known store price is exactly 0.
 */
export function formatStorePrice(opts: {
  usd?: number | null;
  inr?: number | null;
  isFree?: boolean;
  /** How to render USD zero when not treating the row as Free (e.g. top table). */
  zeroUsdAs?: "Free" | "$0";
}): string {
  const { usd, inr, isFree } = opts;
  const usdOk = usd != null && Number.isFinite(usd);
  const inrOk = inr != null && Number.isFinite(inr);

  if (isFree || (usdOk && usd === 0) || (!usdOk && inrOk && inr === 0)) {
    return "Free";
  }

  const parts: string[] = [];
  if (usdOk) {
    parts.push(formatUsd(usd, { zeroAs: opts.zeroUsdAs ?? "Free" }));
  }
  if (inrOk) {
    parts.push(formatInr(inr, { zeroAs: "₹0" }));
  }
  return parts.length ? parts.join(" · ") : "—";
}
