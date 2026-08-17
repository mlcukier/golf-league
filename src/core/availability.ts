import type { Pick } from "../types.js";

/**
 * For each golfer picked at least once this season, the % of the roster
 * that has NOT used them in a previous tournament — a league-wide "how
 * contested is this golfer" signal for the pick dropdown, distinct from the
 * individual one-and-done "(used)" marker, which only reflects the current
 * participant's own history. Picks for currentTournamentId are excluded
 * entirely (this week's picks aren't "previous" yet, no matter how many
 * people have already locked one in), and picks from anyone off the current
 * roster don't count either. A golfer nobody's ever used isn't in the
 * returned map at all — callers should treat a missing entry as 100%.
 */
export function computeGolferAvailability(
  picks: Pick[],
  rosterParticipantIds: string[],
  currentTournamentId: string
): Map<string, number> {
  const availability = new Map<string, number>();
  const rosterSize = rosterParticipantIds.length;
  if (rosterSize === 0) return availability;
  const rosterSet = new Set(rosterParticipantIds);

  const usedBy = new Map<string, Set<string>>();
  for (const p of picks) {
    if (p.tournamentId === currentTournamentId) continue;
    if (!rosterSet.has(p.participantId)) continue;
    let users = usedBy.get(p.golferId);
    if (!users) {
      users = new Set();
      usedBy.set(p.golferId, users);
    }
    users.add(p.participantId);
  }

  for (const [golferId, users] of usedBy) {
    availability.set(golferId, Math.round(((rosterSize - users.size) / rosterSize) * 100));
  }
  return availability;
}
