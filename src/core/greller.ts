import type { Pick, GolferResult, Tournament } from "../types.js";

const WEEKLY_CONTRIBUTION = 10;

export interface GrellerWeekResult {
  tournamentId: string;
  contribution: number;
  /** Participant who uniquely picked the tournament winner, if any. */
  winnerParticipantId: string | null;
  /** Pot balance after this week's contribution and (if won) payout. */
  potBalanceAfter: number;
}

/**
 * The Greller: every participant pays $10/week into a shared pot. A
 * participant wins the week (and the whole accrued pot, which then resets
 * to zero) only if they picked that week's tournament winner AND no other
 * participant also picked that same golfer. If nobody has an exclusive
 * winning pick, the pot rolls over untouched into next week.
 */
export function computeGrellerHistory(
  tournaments: Tournament[],
  picks: Pick[],
  results: GolferResult[],
  participantCount: number,
  weeklyContribution: number = WEEKLY_CONTRIBUTION
): GrellerWeekResult[] {
  const sorted = [...tournaments].sort((a, b) => a.sequence - b.sequence);
  const history: GrellerWeekResult[] = [];
  let pot = 0;

  for (const tournament of sorted) {
    const contribution = participantCount * weeklyContribution;
    pot += contribution;

    const weekResult = results.find((r) => r.tournamentId === tournament.id && r.isWin);
    let winnerParticipantId: string | null = null;

    if (weekResult) {
      const picksOnWinner = picks.filter(
        (p) => p.tournamentId === tournament.id && p.golferId === weekResult.golferId
      );
      if (picksOnWinner.length === 1) {
        winnerParticipantId = picksOnWinner[0]!.participantId;
      }
    }

    if (winnerParticipantId) {
      pot = 0;
    }

    history.push({
      tournamentId: tournament.id,
      contribution,
      winnerParticipantId,
      potBalanceAfter: pot,
    });
  }

  return history;
}
