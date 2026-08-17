import type { League, Season, SeasonEntry, Tournament } from "../types.js";

/** The dollar rules that can vary per season (a test league can play for $0). */
export interface SeasonRules {
  grellerWeeklyContribution: number;
  missedCutFine: number;
  toccStake: number;
  toccStakeIfWinner: number;
}

export const DEFAULT_SEASON_RULES: SeasonRules = {
  grellerWeeklyContribution: 10,
  missedCutFine: 50,
  toccStake: 100,
  toccStakeIfWinner: 200,
};

export interface CreateSeasonInput {
  id: string;
  leagueId: string;
  year: number;
  /** Defaults to Jan 1 of the season year — the league opens Jan 1 and the
   *  first tournament after that date is event 1. */
  startDate?: string;
  rules?: Partial<SeasonRules>;
}

export function createSeason(input: CreateSeasonInput): Season {
  return {
    id: input.id,
    leagueId: input.leagueId,
    year: input.year,
    status: "DRAFT",
    startDate: input.startDate ?? `${input.year}-01-01`,
    endDate: null,
    ...DEFAULT_SEASON_RULES,
    ...input.rules,
  };
}

/**
 * Spins up a test league that runs from `from` through the end of the current
 * year. It's a normal league in every respect except `isTest`, so it exercises
 * the real code paths without touching the main league's money or history.
 */
export function createTestLeague(
  leagueId: string,
  seasonId: string,
  from: Date,
  rules?: Partial<SeasonRules>
): { league: League; season: Season } {
  const year = from.getUTCFullYear();
  const league: League = {
    id: leagueId,
    name: `Test League ${year}`,
    isTest: true,
    createdAt: from.toISOString(),
  };
  const season = createSeason({
    id: seasonId,
    leagueId,
    year,
    startDate: from.toISOString().slice(0, 10),
    rules,
  });
  return { league, season };
}

/**
 * Rolls a league into a new year: a fresh DRAFT season with the same money
 * rules and the same roster. Prior seasons are left untouched, so their
 * tournaments, picks, results, and standings remain queryable as history.
 * The one-and-done pool resets, because picks are scoped to a season.
 */
export function startNewSeason(
  previousSeason: Season,
  newSeasonId: string,
  year: number,
  rosterFrom: SeasonEntry[]
): { season: Season; entries: SeasonEntry[] } {
  const season = createSeason({
    id: newSeasonId,
    leagueId: previousSeason.leagueId,
    year,
    rules: {
      grellerWeeklyContribution: previousSeason.grellerWeeklyContribution,
      missedCutFine: previousSeason.missedCutFine,
      toccStake: previousSeason.toccStake,
      toccStakeIfWinner: previousSeason.toccStakeIfWinner,
    },
  });
  const entries = rosterFrom.map((entry) => ({
    seasonId: newSeasonId,
    participantId: entry.participantId,
    isTOCCMember: entry.isTOCCMember,
  }));
  return { season, entries };
}

/**
 * Selects the tournaments that count for a season: everything starting on or
 * after the season start date, through the finale (the 2nd FedEx Cup playoff
 * event), re-sequenced 1..N in chronological order.
 */
export function selectSeasonTournaments(
  season: Season,
  candidates: Tournament[]
): Tournament[] {
  const start = new Date(season.startDate).getTime();
  const eligible = candidates
    .filter((t) => new Date(t.startTime).getTime() >= start)
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

  const finaleIndex = eligible.findIndex((t) => t.isSeasonFinale);
  const inSeason = finaleIndex >= 0 ? eligible.slice(0, finaleIndex + 1) : eligible;

  return inSeason.map((t, i) => ({ ...t, seasonId: season.id, sequence: i + 1 }));
}
