const BASE_URL = "https://feeds.datagolf.com";

export interface LiveInPlayRow {
  /** DataGolf's "Last, First" format, same as every other feed in this app. */
  playerName: string;
  round: number;
  /** Holes completed in the current round. */
  thru: number;
  /** Holes in the current round (normally 18). */
  endHole: number;
  /** e.g. "1", "T3", "CUT", "WD" — same finish-text convention as historical results, so providers/dataGolfProvider.ts's parseFinishPosition applies here too. */
  currentPos: string | null;
  /** Relative to par. */
  currentScore: number | null;
}

export interface LiveInPlayResult {
  eventName: string;
  currentRound: number;
  lastUpdate: string | null;
  rows: LiveInPlayRow[];
}

/**
 * Pulls DataGolf's live in-play predictions — the closest thing to a
 * leaderboard the API exposes; there is no dedicated leaderboard endpoint
 * (see dataGolfProvider.ts's doc comment for what was tried for *final*
 * results). Confirmed live against this app's existing key: `/preds/in-play`
 * returns per-player `current_pos`/`current_score`/`round`/`thru`/`end_hole`,
 * updating roughly every 5 minutes while a PGA/European Tour event is under
 * way, only including players still active (cut players drop out of `data`
 * entirely rather than lingering with a stale round number). Outside an
 * active event it just returns the last event's final state — harmless,
 * since callers must check `eventName` against the tournament they're
 * asking about (see `liveDataForTournament`) before acting on anything here.
 */
export async function fetchLiveInPlay(
  apiKey: string,
  tour: string = "pga",
  fetchImpl: typeof fetch = fetch
): Promise<LiveInPlayResult> {
  const url = new URL(`${BASE_URL}/preds/in-play`);
  url.searchParams.set("tour", tour);
  url.searchParams.set("file_format", "json");
  url.searchParams.set("key", apiKey);

  const response = await fetchImpl(url.toString());
  if (!response.ok) {
    throw new Error(`DataGolf preds/in-play failed: ${response.status} ${response.statusText}`);
  }
  const raw = (await response.json()) as { data?: unknown[]; info?: Record<string, unknown> };
  const rows = Array.isArray(raw.data) ? raw.data : [];
  const info = raw.info ?? {};

  return {
    eventName: typeof info.event_name === "string" ? info.event_name : "",
    currentRound: typeof info.current_round === "number" ? info.current_round : 0,
    lastUpdate: typeof info.last_update === "string" ? info.last_update : null,
    rows: (rows as Record<string, unknown>[])
      .map((row) => ({
        playerName: typeof row.player_name === "string" ? row.player_name : "",
        round: typeof row.round === "number" ? row.round : 0,
        thru: typeof row.thru === "number" ? row.thru : 0,
        endHole: typeof row.end_hole === "number" ? row.end_hole : 18,
        currentPos: typeof row.current_pos === "string" ? row.current_pos : null,
        currentScore: typeof row.current_score === "number" ? row.current_score : null,
      }))
      .filter((r) => r.playerName.length > 0),
  };
}

/**
 * Only returns live data when it's actually for the named tournament — same
 * safety rule as dataGolfOdds.ts's oddsForTournament, and for the same
 * reason: outside an active event this feed just echoes the last event it
 * has, so callers must never assume rows line up with the tournament they
 * asked about just because the shapes match.
 */
export function liveDataForTournament(
  result: LiveInPlayResult | null,
  tournamentName: string
): LiveInPlayResult | null {
  if (!result) return null;
  if (result.eventName.trim().toLowerCase() !== tournamentName.trim().toLowerCase()) return null;
  return result;
}

/**
 * A round is "complete" once every player still in it has finished every
 * hole, and nobody's still stuck on an earlier round (a suspended-play
 * straggler blocks the *next* round from counting as complete, correctly).
 * An empty feed (nothing live) is never complete. A round with no rows at
 * all, while nothing precedes it, counts as complete too — the field has
 * already moved past it (this is what lets a sweep that missed a tick catch
 * up round-by-round instead of getting stuck).
 */
export function isRoundComplete(rows: LiveInPlayRow[], round: number): boolean {
  if (rows.length === 0) return false;
  if (rows.some((r) => r.round < round)) return false;
  return rows.filter((r) => r.round === round).every((r) => r.thru >= r.endHole);
}
