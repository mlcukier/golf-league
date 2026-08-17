import type { Pick, GolferResult } from "../types.js";

export const DEFAULT_TOCC_STAKE = 100;
export const DEFAULT_TOCC_STAKE_IF_WINNER = 200;

export interface TOCCStakes {
  stake: number;
  stakeIfWinner: number;
}

export interface TOCCRankingRow {
  participantId: string;
  golferId: string;
  earnings: number;
}

export interface TOCCPayment {
  from: string;
  to: string;
  amount: number;
}

export interface TOCCWeekResult {
  tournamentId: string;
  rankings: TOCCRankingRow[];
  /** Usually one participant; more than one only on a tie for 1st. */
  winners: string[];
  /** Breaks even; usually one participant, more than one only on a tie for 2nd. */
  secondPlace: string[];
  payments: TOCCPayment[];
}

/**
 * TOCC side action: ranked only among the opted-in subgroup, using each
 * participant's normal weekly pick. 1st place collects the stake from
 * everyone outside the 1st/2nd tie groups; 2nd place breaks even. The stake
 * doubles to $200/person if the winning pick's golfer actually won the real
 * tournament that week (not just best-in-subgroup).
 *
 * Tie handling (not specified by the league rules as given): a tie for 1st
 * splits the collected stake evenly across the tied winners; a tie for 2nd
 * means everyone in that tie breaks even.
 */
export function computeTOCCWeek(
  tournamentId: string,
  toccParticipantIds: string[],
  weekPicks: Pick[],
  weekResults: GolferResult[],
  stakes: TOCCStakes = { stake: DEFAULT_TOCC_STAKE, stakeIfWinner: DEFAULT_TOCC_STAKE_IF_WINNER }
): TOCCWeekResult {
  const resultByGolfer = new Map(weekResults.map((r) => [r.golferId, r]));

  const rankings: TOCCRankingRow[] = toccParticipantIds
    .map((participantId) => {
      const pick = weekPicks.find(
        (p) => p.participantId === participantId && p.tournamentId === tournamentId
      );
      if (!pick) return null;
      const result = resultByGolfer.get(pick.golferId);
      return { participantId, golferId: pick.golferId, earnings: result?.earnings ?? 0 };
    })
    .filter((r): r is TOCCRankingRow => r !== null)
    .sort((a, b) => b.earnings - a.earnings);

  if (rankings.length === 0) {
    return { tournamentId, rankings: [], winners: [], secondPlace: [], payments: [] };
  }

  const distinctEarnings = [...new Set(rankings.map((r) => r.earnings))];
  const winners = rankings.filter((r) => r.earnings === distinctEarnings[0]).map((r) => r.participantId);
  const secondPlace =
    distinctEarnings.length > 1
      ? rankings.filter((r) => r.earnings === distinctEarnings[1]).map((r) => r.participantId)
      : [];

  const winningGolferId = rankings[0]!.golferId;
  const wonRealTournament = resultByGolfer.get(winningGolferId)?.isWin ?? false;
  const stake = wonRealTournament ? stakes.stakeIfWinner : stakes.stake;

  const payers = rankings
    .map((r) => r.participantId)
    .filter((id) => !winners.includes(id) && !secondPlace.includes(id));

  const payments: TOCCPayment[] = [];
  for (const payer of payers) {
    const share = stake / winners.length;
    for (const winner of winners) {
      payments.push({ from: payer, to: winner, amount: share });
    }
  }

  return { tournamentId, rankings, winners, secondPlace, payments };
}
