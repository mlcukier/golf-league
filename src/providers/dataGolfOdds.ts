const BASE_URL = "https://feeds.datagolf.com";

export interface WinOddsResult {
  eventName: string;
  /** DataGolf's "Last, First" player_name -> American win odds (644 for "+644", -120 for "-120"). */
  oddsByPlayerName: Map<string, number>;
}

/**
 * Parses DataGolf's signed American odds strings ("+644", "-120") into a
 * number. Exported so the mapping is unit testable without a live key.
 */
export function parseAmericanOdds(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^[+-]?\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

/**
 * Pulls DataGolf's model win odds. Confirmed live: `preds/pre-tournament`
 * has no way to pin a specific future event — it just returns whichever
 * event DataGolf currently has predictions for, which can lag the actual
 * upcoming tournament by several days. Callers MUST check `eventName`
 * against the tournament they're pricing before using these odds (see
 * `oddsForTournament`) — never assume they line up.
 */
export async function fetchWinOdds(
  apiKey: string,
  tour: string = "pga",
  fetchImpl: typeof fetch = fetch
): Promise<WinOddsResult> {
  const url = new URL(`${BASE_URL}/preds/pre-tournament`);
  url.searchParams.set("tour", tour);
  url.searchParams.set("odds_format", "american");
  url.searchParams.set("file_format", "json");
  url.searchParams.set("key", apiKey);

  const response = await fetchImpl(url.toString());
  if (!response.ok) {
    throw new Error(`DataGolf preds/pre-tournament failed: ${response.status} ${response.statusText}`);
  }
  const raw = (await response.json()) as { event_name?: string; baseline?: unknown[] };
  const rows = Array.isArray(raw.baseline) ? raw.baseline : [];

  const oddsByPlayerName = new Map<string, number>();
  for (const row of rows) {
    const r = row as Record<string, unknown>;
    const name = typeof r.player_name === "string" ? r.player_name : null;
    const odds = parseAmericanOdds(r.win);
    if (name && odds !== null) oddsByPlayerName.set(name, odds);
  }

  return { eventName: raw.event_name ?? "", oddsByPlayerName };
}

/**
 * Only returns odds when they're actually for the named tournament — never
 * silently hands back last week's (or next month's) numbers mislabeled as
 * current just because the player names happen to overlap.
 */
export function oddsForTournament(
  result: WinOddsResult | null,
  tournamentName: string
): Map<string, number> | null {
  if (!result) return null;
  if (result.eventName.trim().toLowerCase() !== tournamentName.trim().toLowerCase()) return null;
  return result.oddsByPlayerName;
}

export interface OddsCache {
  get(): Promise<WinOddsResult | null>;
}

export interface OddsCacheOptions {
  tour?: string;
  ttlMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/**
 * Odds change constantly and this app has no business persisting a stale
 * snapshot to the JSON store — a short in-memory cache (rather than a
 * per-request live call) is the right tradeoff: fast pages, still fresh
 * within a few minutes. Falls back to the last good result on a fetch error
 * rather than failing the whole page.
 */
export function createOddsCache(apiKey: string, options: OddsCacheOptions = {}): OddsCache {
  const tour = options.tour ?? "pga";
  const ttlMs = options.ttlMs ?? 10 * 60 * 1000;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => Date.now());

  let cached: { fetchedAt: number; result: WinOddsResult } | null = null;

  return {
    async get() {
      if (cached && now() - cached.fetchedAt < ttlMs) return cached.result;
      try {
        const result = await fetchWinOdds(apiKey, tour, fetchImpl);
        cached = { fetchedAt: now(), result };
        return result;
      } catch (err) {
        console.error("DataGolf odds fetch failed:", err);
        return cached?.result ?? null;
      }
    },
  };
}
