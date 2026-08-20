import { randomUUID } from "node:crypto";
import type {
  GolferResult,
  Golfer,
  HearnPick,
  League,
  NotificationRecord,
  Participant,
  PasswordResetToken,
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
  passwordResetTokens: PasswordResetToken[];
  /** Dedupe log for scheduled emails (reminders/digests) — see core/notifications.ts. */
  notifications: NotificationRecord[];
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
    passwordResetTokens: [],
    notifications: [],
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

/**
 * Normalizes a golfer name for identity comparison: lowercase, strip
 * punctuation, sort the words. Matches "Scottie Scheffler" against
 * "Scheffler, Scottie" — the two most common formats this app sees (a
 * DataGolf field/schedule pull uses "Last, First"; free-text pick/results
 * entry tends to be "First Last") — so the same real person never ends up
 * as two different golfer records with two different one-and-done pools.
 */
/** Exported for callers matching names from a different feed (e.g. providers/dataGolfLive.ts) against our canonical golfer names. */
export function normalizeGolferName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.,]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

/** Case-insensitive, word-order-insensitive golfer lookup, used to resolve names from pick emails and free-text entry. */
export function findGolferByName(data: LeagueData, name: string): Golfer | undefined {
  const needle = name.trim().toLowerCase();
  const needleNormalized = normalizeGolferName(name);
  return (
    data.golfers.find((g) => g.name.toLowerCase() === needle) ??
    data.golfers.find((g) => normalizeGolferName(g.name) === needleNormalized) ??
    data.golfers.find((g) => g.name.toLowerCase().includes(needle))
  );
}

/** Case-insensitive participant lookup by email, used to resolve logins and reset requests. */
export function findParticipantByEmail(data: LeagueData, email: string): Participant | undefined {
  const needle = email.trim().toLowerCase();
  return data.participants.find((p) => p.email.toLowerCase() === needle);
}

/** Finds an existing golfer by name or creates one, so admin/self-service entry is forgiving. */
export function upsertGolfer(data: LeagueData, name: string): Golfer {
  const existing = findGolferByName(data, name);
  if (existing) return existing;
  const golfer: Golfer = { id: `g-${randomUUID().slice(0, 8)}`, name: name.trim() };
  data.golfers.push(golfer);
  return golfer;
}
