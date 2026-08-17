import type { StandingRow } from "./scoring.js";
import type { PayoutPlace } from "../types.js";

export interface PayoutRow {
  participantId: string;
  amount: number;
}

/**
 * Distributes a percent-of-pot-per-place payout schedule across a ranked
 * standings list, standard golf-payout tie handling: participants tied on
 * earnings combine the prize money for every place their tie group spans
 * and split it evenly, then the next group picks up at the next open place.
 * A group that runs past the last paid place gets nothing for the unpaid
 * places (e.g. a 2-way tie for a schedule that only pays 1st earns just
 * place 1's share, split two ways — not places 1 and 2).
 *
 * Standings must already be sorted highest-earnings-first (as
 * computeSeasonStandings/computeQuarterlyStandings return them). totalPot is
 * buyIn * roster size — schedule percentages are fractions of that.
 */
export function distributePlacePayouts(
  standings: StandingRow[],
  schedule: PayoutPlace[],
  totalPot: number
): PayoutRow[] {
  if (schedule.length === 0 || standings.length === 0 || totalPot === 0) return [];
  const amountForPlace = new Map(schedule.map((p) => [p.place, totalPot * p.pct]));
  const maxPlace = Math.max(...schedule.map((p) => p.place));

  const out: PayoutRow[] = [];
  let i = 0;
  let place = 1;
  while (i < standings.length && place <= maxPlace) {
    let j = i;
    while (j + 1 < standings.length && standings[j + 1]!.totalEarnings === standings[i]!.totalEarnings) j++;
    const groupSize = j - i + 1;

    let total = 0;
    for (let p = place; p < place + groupSize; p++) total += amountForPlace.get(p) ?? 0;
    const each = total / groupSize;

    for (let k = i; k <= j; k++) out.push({ participantId: standings[k]!.participantId, amount: each });

    place += groupSize;
    i = j + 1;
  }
  return out;
}

/** Sum of every place's % in a schedule — 1.0 means it fully allocates the pot with nothing held back. */
export function payoutSchedulePct(schedule: PayoutPlace[]): number {
  return schedule.reduce((sum, p) => sum + p.pct, 0);
}
