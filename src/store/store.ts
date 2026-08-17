import type {
  GolferResult,
  Golfer,
  HearnPick,
  League,
  Participant,
  Pick,
  Season,
  SeasonEntry,
  Tournament,
} from "../types.js";

/**
 * The whole league database. Small enough (a few dozen people, a few hundred
 * results a year) to live in one JSON document, which keeps the Linux box
 * free of a database dependency. Historical seasons are never pruned.
 */
export interface LeagueData {
  leagues: League[];
  seasons: Season[];
  participants: Participant[];
  seasonEntries: SeasonEntry[];
  tournaments: Tournament[];
  golfers: Golfer[];
  picks: Pick[];
  hearnPicks: HearnPick[];
  results: GolferResult[];
  /** Tournament id -> golfer ids in the field. */
  fields: Record<string, string[]>;
}

export function emptyLeagueData(): LeagueData {
  return {
    leagues: [],
    seasons: [],
    participants: [],
    seasonEntries: [],
    tournaments: [],
    golfers: [],
    picks: [],
    hearnPicks: [],
    results: [],
    fields: {},
  };
}

export interface LeagueStore {
  read(): Promise<LeagueData>;
  /** Applies a mutation atomically and returns the updated data. */
  update(mutator: (data: LeagueData) => void): Promise<LeagueData>;
}

// ---------------------------------------------------------------------------
// Season-scoped read helpers, shared by the admin UI and the weekly jobs.
// ---------------------------------------------------------------------------

export function seasonTournaments(data: LeagueData, seasonId: string): Tournament[] {
  return data.tournaments
    .filter((t) => t.seasonId === seasonId)
    .sort((a, b) => a.sequence - b.sequence);
}

export function seasonPicks(data: LeagueData, seasonId: string): Pick[] {
  return data.picks.filter((p) => p.seasonId === seasonId);
}

export function seasonRoster(data: LeagueData, seasonId: string): Participant[] {
  const ids = new Set(
    data.seasonEntries.filter((e) => e.seasonId === seasonId).map((e) => e.participantId)
  );
  return data.participants.filter((p) => ids.has(p.id));
}

export function toccMemberIds(data: LeagueData, seasonId: string): string[] {
  return data.seasonEntries
    .filter((e) => e.seasonId === seasonId && e.isTOCCMember)
    .map((e) => e.participantId);
}

/** Results limited to the tournaments belonging to one season. */
export function seasonResults(data: LeagueData, seasonId: string): GolferResult[] {
  const tournamentIds = new Set(seasonTournaments(data, seasonId).map((t) => t.id));
  return data.results.filter((r) => tournamentIds.has(r.tournamentId));
}

export function tournamentField(data: LeagueData, tournamentId: string): Set<string> {
  return new Set(data.fields[tournamentId] ?? []);
}

export function golferName(data: LeagueData, golferId: string): string {
  return data.golfers.find((g) => g.id === golferId)?.name ?? golferId;
}

/** Case-insensitive golfer lookup, used to resolve names from pick emails. */
export function findGolferByName(data: LeagueData, name: string): Golfer | undefined {
  const needle = name.trim().toLowerCase();
  return (
    data.golfers.find((g) => g.name.toLowerCase() === needle) ??
    data.golfers.find((g) => g.name.toLowerCase().includes(needle))
  );
}
