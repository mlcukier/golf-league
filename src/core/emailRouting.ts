import { seasonResults, seasonTournaments, type LeagueData } from "../store/store.js";
import type { Participant, Season, Tournament } from "../types.js";

export type SeasonLookupFailure = "NOT_A_PARTICIPANT" | "NO_ACTIVE_SEASON" | "AMBIGUOUS_SEASON";

export interface SeasonLookupResult {
  ok: boolean;
  participant?: Participant;
  season?: Season;
  failure?: SeasonLookupFailure;
}

/**
 * Resolves which season an inbound email applies to. A participant can
 * legitimately be on the roster of more than one ACTIVE season at once (a
 * real season plus a test league) — the real (non-test) league always wins,
 * so a test league in progress can never intercept a real pick.
 */
export function resolveActiveSeasonForParticipant(
  data: LeagueData,
  fromEmail: string
): SeasonLookupResult {
  const email = fromEmail.trim().toLowerCase();
  const participant = data.participants.find((p) => p.email.toLowerCase() === email);
  if (!participant) return { ok: false, failure: "NOT_A_PARTICIPANT" };

  const seasonIds = new Set(
    data.seasonEntries.filter((e) => e.participantId === participant.id).map((e) => e.seasonId)
  );
  const active = data.seasons.filter((s) => seasonIds.has(s.id) && s.status === "ACTIVE");
  if (active.length === 0) return { ok: false, participant, failure: "NO_ACTIVE_SEASON" };

  const leagueById = new Map(data.leagues.map((l) => [l.id, l]));
  const real = active.filter((s) => leagueById.get(s.leagueId)?.isTest !== true);
  const candidates = real.length > 0 ? real : active;

  if (candidates.length > 1) return { ok: false, participant, failure: "AMBIGUOUS_SEASON" };
  return { ok: true, participant, season: candidates[0] };
}

/**
 * A PGA event that started at T is conclusively over by T + this. Events run
 * Thursday through Sunday, so 4 days past a Thursday start lands Monday
 * morning — after the final putt of even a Monday-playoff finish, and well
 * before the next week's Thursday.
 *
 * Shared with `jobs/resultsPull.ts`, which uses the same boundary to decide
 * when it's worth asking DataGolf for an event's results at all. Both
 * answer the same underlying question ("is this event done being played?"),
 * so they must not drift apart: a results pull that fires before
 * `openTournament` rolls over would leave a gap where neither job owns the
 * week.
 */
export const EVENT_COMPLETION_BUFFER_MS = 4 * 24 * 60 * 60 * 1000;

/**
 * The tournament presently open for picking, league-wide: the earliest
 * tournament in the season that has no posted results *and* hasn't already
 * finished being played.
 *
 * Judging "over" by posted results alone is the natural reading, and it's
 * what this did originally, but it makes every downstream consumer hostage
 * to a result that may never arrive. That's not hypothetical: the 2026
 * Presidents Cup is a team exhibition with no prize money, and DataGolf
 * doesn't carry it in the PGA calendar at all (the results pull 400s on its
 * event id forever). With results as the only exit condition, that one
 * event pinned the whole league — participants were still shown a pick due
 * for a tournament that had finished days earlier, and `jobs/fieldUpdate.ts`
 * kept re-checking the dead event instead of advancing to the next one, so
 * the upcoming tournament never got a field. The schedule has to be able to
 * move on without a result, because sometimes there is never going to be one.
 *
 * Hence the second clause. It is deliberately NOT "the deadline passed":
 * that would reintroduce a bug this function was written to avoid, where a
 * pick submitted just after a deadline silently targets NEXT week instead of
 * being rejected as too late for this one, since the currently-open
 * tournament would have rolled over the instant play began. Keying on
 * start + EVENT_COMPLETION_BUFFER_MS keeps the tournament current for the
 * entire time it's actually being played — late picks still land on it and
 * are still rejected by `validatePick` — and only rolls over once it's over.
 *
 * Note that a tournament skipped this way is skipped for *display and
 * targeting* only. It keeps its picks, it still owes the Greller its weekly
 * ante (`core/report.ts` counts every week up to and including the open
 * one), and posting its results later still scores it normally. Nothing is
 * forfeited by rolling past it; it just stops blocking the queue.
 *
 * This used to also skip tournaments the calling participant already had a
 * pick for, which broke changing a pick: once you'd picked this week, the
 * app would show you *next* week's (empty) picker instead of this week's
 * (filled) one. Now pick submission always names an explicit tournamentId
 * (see commands.ts), so callers use this purely to know which week to
 * *display* — including a participant's existing pick for it, if any, so
 * they can change it before the deadline.
 */
export function openTournament(
  data: LeagueData,
  seasonId: string,
  now: Date = new Date()
): Tournament | undefined {
  const finished = new Set(seasonResults(data, seasonId).map((r) => r.tournamentId));
  return seasonTournaments(data, seasonId).find((t) => {
    if (finished.has(t.id)) return false;
    const concluded = now.getTime() - new Date(t.startTime).getTime() >= EVENT_COMPLETION_BUFFER_MS;
    return !concluded;
  });
}
