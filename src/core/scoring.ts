import type { Pick, GolferResult, QuarterBoundary, Tournament } from "../types.js";

export interface StandingRow {
  participantId: string;
  totalEarnings: number;
}

function resultKey(tournamentId: string, golferId: string): string {
  return `${tournamentId}::${golferId}`;
}

function indexResults(results: GolferResult[]): Map<string, GolferResult> {
  const map = new Map<string, GolferResult>();
  for (const r of results) map.set(resultKey(r.tournamentId, r.golferId), r);
  return map;
}

/** Earnings a single pick produced. 0 if no result is posted yet. */
export function pickEarnings(pick: Pick, resultsByKey: Map<string, GolferResult>): number {
  const result = resultsByKey.get(resultKey(pick.tournamentId, pick.golferId));
  return result?.earnings ?? 0;
}

/** Season-long standings: sum of each participant's weekly pick earnings, highest first. */
export function computeSeasonStandings(picks: Pick[], results: GolferResult[]): StandingRow[] {
  const resultsByKey = indexResults(results);
  const totals = new Map<string, number>();
  for (const pick of picks) {
    const earnings = pickEarnings(pick, resultsByKey);
    totals.set(pick.participantId, (totals.get(pick.participantId) ?? 0) + earnings);
  }
  return [...totals.entries()]
    .map(([participantId, totalEarnings]) => ({ participantId, totalEarnings }))
    .sort((a, b) => b.totalEarnings - a.totalEarnings);
}

/**
 * Quarterly standings: same as season standings, but scoped to picks whose
 * tournament falls within the quarter's sequence range.
 */
export function computeQuarterlyStandings(
  picks: Pick[],
  results: GolferResult[],
  tournaments: Tournament[],
  boundaries: QuarterBoundary[]
): Record<number, StandingRow[]> {
  const sequenceByTournament = new Map(tournaments.map((t) => [t.id, t.sequence]));
  const out: Record<number, StandingRow[]> = {};

  for (const boundary of boundaries) {
    const picksInQuarter = picks.filter((p) => {
      const seq = sequenceByTournament.get(p.tournamentId);
      return seq !== undefined && seq >= boundary.firstSequence && seq <= boundary.lastSequence;
    });
    out[boundary.quarter] = computeSeasonStandings(picksInQuarter, results);
  }
  return out;
}

/** Evenly splits a season's tournaments (in sequence order) into 4 quarters. */
export function buildEqualQuarterBoundaries(tournaments: Tournament[]): QuarterBoundary[] {
  const sorted = [...tournaments].sort((a, b) => a.sequence - b.sequence);
  const n = sorted.length;
  const base = Math.floor(n / 4);
  const remainder = n % 4;

  const boundaries: QuarterBoundary[] = [];
  let cursor = 0;
  for (let q = 1; q <= 4; q++) {
    const size = base + (q <= remainder ? 1 : 0);
    const firstSequence = sorted[cursor]!.sequence;
    const lastSequence = sorted[cursor + size - 1]!.sequence;
    boundaries.push({ quarter: q as 1 | 2 | 3 | 4, firstSequence, lastSequence });
    cursor += size;
  }
  return boundaries;
}
