import { applyResults, type SendMail } from "../admin/server.js";
import { EVENT_COMPLETION_BUFFER_MS } from "../core/emailRouting.js";
import { fetchDataGolfEventResults } from "../providers/dataGolfProvider.js";
import type { LeagueStore } from "../store/store.js";

/**
 * How long after a tournament's stored startTime (Thursday tee time) to wait
 * before asking DataGolf for a final leaderboard. Shared with
 * `core/emailRouting.ts`, which uses the same boundary to decide when a
 * tournament stops being the league's currently-open one — see that
 * constant's comment for why the two must stay identical.
 *
 * Being early just means an empty event_stats response and a quiet retry
 * next sweep, which costs nothing, whereas a too-short buffer would mean
 * repeated wasted calls during the event.
 */
const COMPLETION_BUFFER_MS = EVENT_COMPLETION_BUFFER_MS;

/**
 * Auto-pulls real results from DataGolf for any tournament that has a
 * DataGolf externalEventId, started at least COMPLETION_BUFFER_MS ago, and
 * has no results posted yet. Safe to call every sweep tick: once results
 * exist for a tournament (from here or a manual admin paste) it's never
 * reconsidered, so there's no risk of clobbering a manual correction, and if
 * DataGolf hasn't posted the event yet this quietly does nothing and tries
 * again next tick. Goes through the same applyResults as the admin Results
 * paste route, so the results digest fires exactly the same way either way.
 */
export async function runResultsPullSweep(
  store: LeagueStore,
  sendMail: SendMail,
  apiKey: string,
  tour: string = "pga",
  now: Date = new Date()
): Promise<void> {
  const data = await store.read();
  const hasResults = new Set(data.results.map((r) => r.tournamentId));

  const candidates = data.tournaments.filter(
    (t) =>
      t.externalEventId &&
      !hasResults.has(t.id) &&
      now.getTime() - new Date(t.startTime).getTime() >= COMPLETION_BUFFER_MS
  );

  for (const tournament of candidates) {
    const season = data.seasons.find((s) => s.id === tournament.seasonId);
    if (!season) continue;
    try {
      const rows = await fetchDataGolfEventResults(apiKey, tour, tournament.externalEventId!, season.year);
      if (rows.length === 0) continue; // not posted on DataGolf's side yet — retry next sweep
      await applyResults(store, tournament.id, rows, sendMail);
      console.log(`Auto-pulled DataGolf results for ${tournament.name} (${rows.length} rows).`);
    } catch (err) {
      console.error(`DataGolf results pull failed for ${tournament.name}:`, err);
    }
  }
}
