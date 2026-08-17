import type { Pick, GolferResult } from "../types.js";

export const DEFAULT_MISSED_CUT_FINE = 50;

function resultFor(pick: Pick, results: GolferResult[]): GolferResult | undefined {
  return results.find((r) => r.tournamentId === pick.tournamentId && r.golferId === pick.golferId);
}

/**
 * Side Pot 1 is funded by missed-cut fines: any roster member whose weekly
 * pick misses the cut owes the fine into the pot — and so does anyone with
 * no pick at all that week (no self-pick, exhausted Hearn list), treated the
 * same as a missed cut, since not fielding a golfer is strictly worse than
 * fielding one who missed the cut. Only counted once a tournament's results
 * are actually posted — playedTournamentIds is the set to charge for; a
 * tournament that's still in progress charges nobody yet.
 */
export function computeSidePot1Balance(
  picks: Pick[],
  results: GolferResult[],
  rosterParticipantIds: string[],
  playedTournamentIds: string[],
  missedCutFine: number = DEFAULT_MISSED_CUT_FINE
): number {
  let balance = 0;
  for (const tournamentId of playedTournamentIds) {
    for (const participantId of rosterParticipantIds) {
      const pick = picks.find((p) => p.participantId === participantId && p.tournamentId === tournamentId);
      if (!pick) {
        balance += missedCutFine;
        continue;
      }
      const result = resultFor(pick, results);
      if (result && !result.madeCut) balance += missedCutFine;
    }
  }
  return balance;
}

export interface SidePot1Tally {
  participantId: string;
  missedCuts: number;
  top10s: number;
  top5s: number;
  wins: number;
}

/**
 * Per-participant counts of missed cuts (no pick at all counts as one, same
 * as computeSidePot1Balance) and top-10/top-5/win finishes among their own
 * picks, for standings display. Every roster member appears, even at
 * all-zero, so the admin table always shows the full roster.
 */
export function computeSidePot1Tallies(
  picks: Pick[],
  results: GolferResult[],
  rosterParticipantIds: string[],
  playedTournamentIds: string[]
): SidePot1Tally[] {
  const tallies = new Map<string, SidePot1Tally>();
  const get = (participantId: string) => {
    let t = tallies.get(participantId);
    if (!t) {
      t = { participantId, missedCuts: 0, top10s: 0, top5s: 0, wins: 0 };
      tallies.set(participantId, t);
    }
    return t;
  };

  for (const participantId of rosterParticipantIds) get(participantId);

  for (const tournamentId of playedTournamentIds) {
    for (const participantId of rosterParticipantIds) {
      const t = get(participantId);
      const pick = picks.find((p) => p.participantId === participantId && p.tournamentId === tournamentId);
      if (!pick) {
        t.missedCuts += 1;
        continue;
      }
      const result = resultFor(pick, results);
      if (!result) continue;
      if (!result.madeCut) t.missedCuts += 1;
      if (result.isTop10) t.top10s += 1;
      if (result.isTop5) t.top5s += 1;
      if (result.isWin) t.wins += 1;
    }
  }

  return [...tallies.values()];
}

/**
 * Season-end winner of Side Pot 1: most top-10 picks, tied broken by most
 * top-5 picks, then most wins. Returns every participant tied for first
 * after all tiebreakers (a true tie splits the pot).
 */
export function determineSidePot1Winners(tallies: SidePot1Tally[]): SidePot1Tally[] {
  if (tallies.length === 0) return [];
  const sorted = [...tallies].sort(
    (a, b) => b.top10s - a.top10s || b.top5s - a.top5s || b.wins - a.wins
  );
  const best = sorted[0]!;
  return sorted.filter(
    (t) => t.top10s === best.top10s && t.top5s === best.top5s && t.wins === best.wins
  );
}
