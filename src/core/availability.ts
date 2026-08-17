import type { Pick } from "../types.js";

export interface AvailabilityCount {
  /** How many of the cohort have NOT used this golfer in a previous tournament. */
  available: number;
  /** Cohort size — always equal to the cohort passed in, repeated here so a caller never has to thread it separately. */
  total: number;
}

/**
 * For each golfer picked at least once this season (by anyone in the given
 * cohort), how many of that cohort have NOT used them in a previous
 * tournament — a league-wide "how contested is this golfer" signal, e.g. for
 * the pick page's "available in X of Y entries" display. Distinct from the
 * individual one-and-done "(used)" marker, which only reflects the current
 * participant's own history.
 *
 * The cohort is caller-defined, not always the whole roster — e.g. "everyone
 * ranked ahead of you in the season standings" is a valid, smaller cohort.
 * Picks for currentTournamentId are excluded entirely (this week's picks
 * aren't "previous" yet, no matter how many people already locked one in),
 * and picks from anyone off the cohort don't count either. A golfer nobody
 * in the cohort has ever used isn't in the returned map at all — callers
 * should treat a missing entry as fully available ({ available: total,
 * total }, i.e. nobody in the cohort has used it).
 */
export function computeGolferAvailability(
  picks: Pick[],
  cohortParticipantIds: string[],
  currentTournamentId: string
): Map<string, AvailabilityCount> {
  const availability = new Map<string, AvailabilityCount>();
  const total = cohortParticipantIds.length;
  if (total === 0) return availability;
  const cohortSet = new Set(cohortParticipantIds);

  const usedBy = new Map<string, Set<string>>();
  for (const p of picks) {
    if (p.tournamentId === currentTournamentId) continue;
    if (!cohortSet.has(p.participantId)) continue;
    let users = usedBy.get(p.golferId);
    if (!users) {
      users = new Set();
      usedBy.set(p.golferId, users);
    }
    users.add(p.participantId);
  }

  for (const [golferId, users] of usedBy) {
    availability.set(golferId, { available: total - users.size, total });
  }
  return availability;
}

/** Looks up a golfer's availability, defaulting to "fully available" when the golfer has no entry (nobody in the cohort has used it). */
export function getAvailability(
  availability: Map<string, AvailabilityCount>,
  golferId: string,
  cohortSize: number
): AvailabilityCount {
  return availability.get(golferId) ?? { available: cohortSize, total: cohortSize };
}
