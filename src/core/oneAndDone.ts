import type { Pick } from "../types.js";

export type PickRejectionReason =
  | "GOLFER_ALREADY_USED"
  | "ALREADY_PICKED_THIS_WEEK"
  | "GOLFER_NOT_IN_FIELD"
  | "PAST_DEADLINE";

/**
 * Reasons that an admin may knowingly override. GOLFER_ALREADY_USED and
 * ALREADY_PICKED_THIS_WEEK are deliberately absent: one-and-done is sacrosanct
 * and no override path may ever bypass it.
 */
export const OVERRIDABLE_REJECTIONS: ReadonlySet<PickRejectionReason> = new Set([
  "PAST_DEADLINE",
  "GOLFER_NOT_IN_FIELD",
]);

export interface PickValidationResult {
  ok: boolean;
  /**
   * EVERY violation found, not just the first. Callers that override some
   * reasons must see the others — short-circuiting here once let a forced
   * past-deadline pick slip a duplicate golfer through.
   */
  reasons: PickRejectionReason[];
  /** Highest-priority reason, for single-line messaging. */
  reason?: PickRejectionReason;
  /** For GOLFER_ALREADY_USED: which tournament the golfer was already used in. */
  previouslyUsedInTournamentId?: string;
}

export interface ValidatePickInput {
  participantId: string;
  seasonId: string;
  tournamentId: string;
  golferId: string;
  /** When the pick email was RECEIVED. Must be strictly before tournamentStartTime. */
  receivedAt: string; // ISO datetime
  /** Round 1 tee-off. The pick deadline is this instant, exclusive. */
  tournamentStartTime: string; // ISO datetime
  /** Every pick this participant has already made in THIS season. */
  existingPicks: Pick[];
  /** Golfer ids confirmed in this week's tournament field. */
  tournamentField: Set<string>;
}

/**
 * Enforces the league's core rules: a participant may use each golfer at most
 * once per season, exactly one pick per week, received before the tournament
 * starts, and only from golfers actually in the field.
 *
 * One-and-done is checked against the participant's picks in this season only —
 * the pool resets each year.
 */
export function validatePick(input: ValidatePickInput): PickValidationResult {
  const reasons: PickRejectionReason[] = [];

  const seasonPicks = input.existingPicks.filter(
    (p) => p.participantId === input.participantId && p.seasonId === input.seasonId
  );

  // One-and-done first: it outranks everything and can never be overridden.
  const reusedPick = seasonPicks.find((p) => p.golferId === input.golferId);
  if (reusedPick) reasons.push("GOLFER_ALREADY_USED");
  if (seasonPicks.some((p) => p.tournamentId === input.tournamentId)) {
    reasons.push("ALREADY_PICKED_THIS_WEEK");
  }

  if (!input.tournamentField.has(input.golferId)) reasons.push("GOLFER_NOT_IN_FIELD");

  const received = new Date(input.receivedAt).getTime();
  const deadline = new Date(input.tournamentStartTime).getTime();
  if (received >= deadline) reasons.push("PAST_DEADLINE");

  return {
    ok: reasons.length === 0,
    reasons,
    reason: reasons[0],
    previouslyUsedInTournamentId: reusedPick?.tournamentId,
  };
}

/**
 * Violations that survive an admin override. Always non-empty when a pick
 * breaks one-and-done, whatever `force` is set to.
 */
export function blockingReasons(
  validation: PickValidationResult,
  force: boolean
): PickRejectionReason[] {
  if (!force) return validation.reasons;
  return validation.reasons.filter((r) => !OVERRIDABLE_REJECTIONS.has(r));
}

/**
 * Golfer ids a participant has already burned in a season. This is the
 * authoritative one-and-done pool used by both manual picks and the Hearn
 * fallback engine.
 */
export function usedGolferIds(
  participantId: string,
  seasonId: string,
  picks: Pick[]
): Set<string> {
  return new Set(
    picks
      .filter((p) => p.participantId === participantId && p.seasonId === seasonId)
      .map((p) => p.golferId)
  );
}
