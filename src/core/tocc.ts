import type { Pick, GolferResult } from "../types.js";

export const DEFAULT_TOCC_STAKE = 100;
export const DEFAULT_TOCC_STAKE_IF_WINNER = 200;

export interface TOCCStakes {
  stake: number;
  stakeIfWinner: number;
}

export interface TOCCRankingRow {
  participantId: string;
  /** Null when the participant had no pick at all that week — they still owe the stake like anyone else who didn't win/place. */
  golferId: string | null;
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
 * A subgroup member with no pick at all that week (no self-pick, no valid
 * Hearn fallback) is still ranked — at $0 earnings, same as anyone who
 * missed the cut — because being on the TOCC roster is what creates the
 * wager, not whether a pick actually landed. They can only ever be a payer
 * (a $0 week can't beat anyone who made the cut) unless the whole subgroup
 * is at $0, in which case everyone ties for 1st and no money moves.
 *
 * Tie handling: places are consumed by tie-group size, same convention a
 * real golf leaderboard uses — a group tied on earnings occupies as many
 * consecutive places as its size (a 2-way tie for 1st occupies places 1
 * AND 2). So a tie for 1st "counts for 1st and 2nd": the tied golfers split
 * the winnings, and there is no separate 2nd-place break-even that week —
 * whoever has the next-best earnings is really in 3rd (or later) and pays
 * like anyone else outside the tie. The 2nd-place break-even only exists
 * when place 2 isn't already claimed by the 1st-place group, i.e. exactly
 * one participant is alone in 1st.
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
      if (!pick) return { participantId, golferId: null, earnings: 0 };
      const result = resultByGolfer.get(pick.golferId);
      return { participantId, golferId: pick.golferId, earnings: result?.earnings ?? 0 };
    })
    .sort((a, b) => b.earnings - a.earnings);

  if (rankings.length === 0) {
    return { tournamentId, rankings: [], winners: [], secondPlace: [], payments: [] };
  }

  // Group consecutive ties, tracking which 1-based place range each group occupies.
  const groups: { rows: TOCCRankingRow[]; startPlace: number; endPlace: number }[] = [];
  let place = 1;
  for (let i = 0; i < rankings.length; ) {
    let j = i;
    while (j + 1 < rankings.length && rankings[j + 1]!.earnings === rankings[i]!.earnings) j++;
    const rows = rankings.slice(i, j + 1);
    groups.push({ rows, startPlace: place, endPlace: place + rows.length - 1 });
    place += rows.length;
    i = j + 1;
  }

  const winnerGroup = groups[0]!;
  const winners = winnerGroup.rows.map((r) => r.participantId);
  // Only a solo 1st place leaves place 2 open for a separate break-even group.
  const secondGroup = winnerGroup.endPlace === 1 && groups[1]?.startPlace === 2 ? groups[1] : undefined;
  const secondPlace = secondGroup ? secondGroup.rows.map((r) => r.participantId) : [];

  const wonRealTournament = winnerGroup.rows.some(
    (r) => r.golferId !== null && (resultByGolfer.get(r.golferId)?.isWin ?? false)
  );
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
