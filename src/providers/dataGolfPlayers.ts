const BASE_URL = "https://feeds.datagolf.com";

export interface PgaTourPlayer {
  name: string; // DataGolf's "Last, First" format, same as field-updates/odds
}

/**
 * The full PGA Tour player pool, for the Hearn list — a season-long fallback
 * that can be called on for ANY future week, unlike the weekly pick which is
 * rightly scoped to just that week's confirmed field. `get-player-list` (used
 * for the weekly field) has no tour filter and returns ~3,500 players across
 * every tour DataGolf tracks; `get-dg-rankings` carries a `primary_tour`
 * field instead, so filtering to "PGA" gives a right-sized, real roster.
 */
export async function fetchPgaTourPlayers(
  apiKey: string,
  fetchImpl: typeof fetch = fetch
): Promise<PgaTourPlayer[]> {
  const url = new URL(`${BASE_URL}/preds/get-dg-rankings`);
  url.searchParams.set("file_format", "json");
  url.searchParams.set("key", apiKey);

  const response = await fetchImpl(url.toString());
  if (!response.ok) {
    throw new Error(`DataGolf get-dg-rankings failed: ${response.status} ${response.statusText}`);
  }
  const raw = (await response.json()) as { rankings?: unknown[] };
  const rows = Array.isArray(raw.rankings) ? raw.rankings : [];

  return rows
    .map((row) => row as Record<string, unknown>)
    .filter((row) => row.primary_tour === "PGA" && typeof row.player_name === "string")
    .map((row) => ({ name: row.player_name as string }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface PlayerListCache {
  get(): Promise<PgaTourPlayer[] | null>;
}

export interface PlayerListCacheOptions {
  ttlMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/**
 * The tour roster changes rarely, so this caches much longer than odds (24h
 * default vs 10m) — still falls back to the last good list on a fetch error
 * rather than leaving the Hearn picker empty.
 */
export function createPlayerListCache(apiKey: string, options: PlayerListCacheOptions = {}): PlayerListCache {
  const ttlMs = options.ttlMs ?? 24 * 60 * 60 * 1000;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => Date.now());

  let cached: { fetchedAt: number; result: PgaTourPlayer[] } | null = null;

  return {
    async get() {
      if (cached && now() - cached.fetchedAt < ttlMs) return cached.result;
      try {
        const result = await fetchPgaTourPlayers(apiKey, fetchImpl);
        cached = { fetchedAt: now(), result };
        return result;
      } catch (err) {
        console.error("DataGolf player list fetch failed:", err);
        return cached?.result ?? null;
      }
    },
  };
}
