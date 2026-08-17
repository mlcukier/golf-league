import type { GolferResult, HearnPick, Pick, Tournament } from "../types.js";

export const SEASON_ID = "s2026";

export function tournament(
  id: string,
  sequence: number,
  overrides: Partial<Tournament> = {}
): Tournament {
  return {
    id,
    seasonId: SEASON_ID,
    name: `Event ${sequence}`,
    sequence,
    // Weekly cadence starting Jan 8 2026, 08:00Z — also the pick deadline.
    startTime: new Date(Date.UTC(2026, 0, 8 + (sequence - 1) * 7, 8, 0, 0)).toISOString(),
    isSeasonFinale: false,
    ...overrides,
  };
}

export function pick(
  participantId: string,
  tournamentId: string,
  golferId: string,
  overrides: Partial<Pick> = {}
): Pick {
  return {
    participantId,
    seasonId: SEASON_ID,
    tournamentId,
    golferId,
    submittedAt: "2026-01-01T00:00:00Z",
    source: "web",
    ...overrides,
  };
}

/** A finishing result. Pass finishPosition null for a missed cut. */
export function result(
  tournamentId: string,
  golferId: string,
  earnings: number,
  finishPosition: number | null
): GolferResult {
  return {
    tournamentId,
    golferId,
    earnings,
    finishPosition,
    madeCut: finishPosition !== null,
    isWin: finishPosition === 1,
    isTop5: finishPosition !== null && finishPosition <= 5,
    isTop10: finishPosition !== null && finishPosition <= 10,
  };
}

export function hearn(participantId: string, golferId: string, rank: number): HearnPick {
  return { seasonId: SEASON_ID, participantId, golferId, rank };
}
