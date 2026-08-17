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
 * The tournament presently open for picking, league-wide: the earliest
 * tournament in the season with no posted results yet. Deliberately
 * clock-independent and participant-independent — "over" is judged by
 * posted results, not the clock or any one participant's pick status.
 *
 * This used to also skip tournaments the calling participant already had a
 * pick for, which broke changing a pick: once you'd picked this week, the
 * app would show you *next* week's (empty) picker instead of this week's
 * (filled) one. Now pick submission always names an explicit tournamentId
 * (see commands.ts), so callers use this purely to know which week to
 * *display* — including a participant's existing pick for it, if any, so
 * they can change it before the deadline.
 *
 * Using the clock instead of results ("deadline passed") would reintroduce
 * a different bug: a pick submitted right after a deadline passes would
 * silently target NEXT week instead of being rejected as too late for this
 * one, since the currently-open tournament would already have rolled over.
 * `validatePick` still enforces the deadline itself, on whatever
 * tournamentId is actually submitted — this function only decides what to
 * show as "current."
 */
export function openTournament(data: LeagueData, seasonId: string): Tournament | undefined {
  const finished = new Set(seasonResults(data, seasonId).map((r) => r.tournamentId));
  return seasonTournaments(data, seasonId).find((t) => !finished.has(t.id));
}
