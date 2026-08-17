import type { HearnPick, Pick } from "../types.js";
import { usedGolferIds } from "./oneAndDone.js";

export type HearnSkipReason = "ALREADY_USED" | "NOT_IN_FIELD";

export interface HearnCandidateEvaluation {
  golferId: string;
  rank: number;
  /** Undefined when this candidate was selected. */
  skipped?: HearnSkipReason;
}

export interface HearnResolution {
  participantId: string;
  seasonId: string;
  tournamentId: string;
  /** null when the participant's whole Hearn list is exhausted or unusable. */
  golferId: string | null;
  /** Every candidate considered, in rank order, with why each was skipped. */
  evaluated: HearnCandidateEvaluation[];
}

export interface ResolveHearnPickInput {
  participantId: string;
  seasonId: string;
  tournamentId: string;
  /** The participant's Hearn list for this season (any order; sorted by rank here). */
  hearnList: HearnPick[];
  /** All picks in this season, used to derive the one-and-done pool. */
  existingPicks: Pick[];
  /** Golfer ids in this week's field. */
  tournamentField: Set<string>;
}

/**
 * Walks a participant's Hearn list in rank order and returns the first golfer
 * that is BOTH unused by that participant this season AND in this week's field.
 *
 * The one-and-done rule is sacrosanct: a Hearn candidate the participant has
 * already used is skipped, never assigned. If every candidate is exhausted the
 * result is null — the participant takes a zero for the week rather than the
 * engine ever burning a golfer twice.
 */
export function resolveHearnPick(input: ResolveHearnPickInput): HearnResolution {
  const used = usedGolferIds(input.participantId, input.seasonId, input.existingPicks);

  const candidates = input.hearnList
    .filter((h) => h.participantId === input.participantId && h.seasonId === input.seasonId)
    .sort((a, b) => a.rank - b.rank);

  const evaluated: HearnCandidateEvaluation[] = [];

  for (const candidate of candidates) {
    if (used.has(candidate.golferId)) {
      evaluated.push({ golferId: candidate.golferId, rank: candidate.rank, skipped: "ALREADY_USED" });
      continue;
    }
    if (!input.tournamentField.has(candidate.golferId)) {
      evaluated.push({ golferId: candidate.golferId, rank: candidate.rank, skipped: "NOT_IN_FIELD" });
      continue;
    }
    evaluated.push({ golferId: candidate.golferId, rank: candidate.rank });
    return {
      participantId: input.participantId,
      seasonId: input.seasonId,
      tournamentId: input.tournamentId,
      golferId: candidate.golferId,
      evaluated,
    };
  }

  return {
    participantId: input.participantId,
    seasonId: input.seasonId,
    tournamentId: input.tournamentId,
    golferId: null,
    evaluated,
  };
}

export interface ApplyHearnFallbacksInput {
  seasonId: string;
  tournamentId: string;
  /** Everyone on the season roster. */
  participantIds: string[];
  hearnLists: HearnPick[];
  existingPicks: Pick[];
  tournamentField: Set<string>;
  /** Timestamp recorded on generated picks (normally the tournament start time). */
  assignedAt: string;
}

export interface ApplyHearnFallbacksResult {
  /** Picks to persist, one per participant who was auto-assigned. */
  picks: Pick[];
  /** Full audit trail, including participants left with no valid Hearn option. */
  resolutions: HearnResolution[];
  /** Participants who had no pick and whose Hearn list yielded nothing. */
  unresolved: string[];
}

/**
 * Runs at each tournament's deadline: every roster participant without a pick
 * for the week gets their highest-ranked still-legal Hearn golfer.
 *
 * Assignments are applied sequentially and folded back into the working pick
 * set, so two auto-assignments for the same participant can never collide, and
 * each resolution sees the picks made before it.
 */
export function applyHearnFallbacks(
  input: ApplyHearnFallbacksInput
): ApplyHearnFallbacksResult {
  const working = [...input.existingPicks];
  const generated: Pick[] = [];
  const resolutions: HearnResolution[] = [];
  const unresolved: string[] = [];

  for (const participantId of input.participantIds) {
    const alreadyPicked = working.some(
      (p) =>
        p.participantId === participantId &&
        p.seasonId === input.seasonId &&
        p.tournamentId === input.tournamentId
    );
    if (alreadyPicked) continue;

    const resolution = resolveHearnPick({
      participantId,
      seasonId: input.seasonId,
      tournamentId: input.tournamentId,
      hearnList: input.hearnLists,
      existingPicks: working,
      tournamentField: input.tournamentField,
    });
    resolutions.push(resolution);

    if (resolution.golferId === null) {
      unresolved.push(participantId);
      continue;
    }

    const pick: Pick = {
      participantId,
      seasonId: input.seasonId,
      tournamentId: input.tournamentId,
      golferId: resolution.golferId,
      submittedAt: input.assignedAt,
      source: "hearn",
    };
    generated.push(pick);
    working.push(pick);
  }

  return { picks: generated, resolutions, unresolved };
}

/**
 * Flags Hearn list entries that can no longer ever be used this season because
 * the participant already burned that golfer. Surfaced in the admin UI so a
 * stale list gets refreshed before it silently runs short.
 */
export function findDeadHearnEntries(
  seasonId: string,
  hearnLists: HearnPick[],
  picks: Pick[]
): HearnPick[] {
  return hearnLists
    .filter((h) => h.seasonId === seasonId)
    .filter((h) => usedGolferIds(h.participantId, seasonId, picks).has(h.golferId));
}
