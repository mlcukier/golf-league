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
  /**
   * Participants already run through resolution for this tournament, on a
   * prior sweep tick — skipped even if that attempt came back null. Without
   * this, a participant whose list was exhausted stays "unresolved" forever
   * and every future sweep tick tries again with whatever their Hearn list
   * looks like *then* — which is exactly the loophole this guards against:
   * watch the tournament live, edit your list, get an informed pick in
   * through the "forgot to pick" fallback. See hearnListLockStatus below,
   * which uses the same one-attempt-ever record to freeze list edits until
   * that attempt happens.
   */
  alreadyAttemptedParticipantIds?: Set<string>;
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
    if (input.alreadyAttemptedParticipantIds?.has(participantId)) continue;

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

export interface HearnListLockCheck {
  seasonId: string;
  participantId: string;
  /** Every tournament in the participant's season. */
  tournaments: { id: string; startTime: string }[];
  existingPicks: Pick[];
  /**
   * Tournament ids where Hearn resolution has already been attempted for
   * this participant (see alreadyAttemptedParticipantIds on
   * ApplyHearnFallbacksInput) — regardless of outcome.
   */
  attemptedTournamentIds: Set<string>;
  now: Date;
}

export interface HearnListLockResult {
  locked: boolean;
  /** The tournament forcing the lock, when locked. */
  tournamentId?: string;
}

/**
 * A participant's Hearn list is the fallback for "I forgot to pick", not a
 * second chance to pick once the tournament is underway — so it must stay
 * frozen from the moment a tournament's deadline passes until Hearn
 * resolution has actually been attempted for that participant. Without
 * this, someone with no pick could watch the tournament start, see who's
 * playing well, and edit their list before the next sweep tick resolves
 * them, turning the "forgot to pick" safety net into a way to submit an
 * informed pick after the deadline.
 *
 * The lock lifts the instant resolution is attempted, success or not — a
 * genuinely exhausted list is a real zero for that week (see
 * applyHearnFallbacks), not a reason to keep blocking edits meant to
 * prepare for future weeks.
 */
export function hearnListLockStatus(input: HearnListLockCheck): HearnListLockResult {
  const pickedTournamentIds = new Set(
    input.existingPicks
      .filter((p) => p.participantId === input.participantId && p.seasonId === input.seasonId)
      .map((p) => p.tournamentId)
  );
  const blocking = input.tournaments.find(
    (t) =>
      new Date(t.startTime).getTime() <= input.now.getTime() &&
      !pickedTournamentIds.has(t.id) &&
      !input.attemptedTournamentIds.has(t.id)
  );
  return blocking ? { locked: true, tournamentId: blocking.id } : { locked: false };
}
