import type { Golfer, GolferResult, Tournament } from "../types.js";

/**
 * Adapter boundary between the league engine and whichever live golf stats
 * API gets picked (e.g. SportsData.io, Sportradar). Swapping providers means
 * writing one new implementation of this interface — nothing in src/core
 * depends on a specific vendor's response shape.
 */
export interface GolfDataProvider {
  /** Upcoming/current-season tournament schedule. */
  getSeasonSchedule(seasonYear: number): Promise<Tournament[]>;

  /** Confirmed field (golfers entered) for a tournament, used to validate picks. */
  getTournamentField(tournamentId: string): Promise<Golfer[]>;

  /**
   * Posted results for a tournament. Returns [] while the tournament is
   * still in progress. `year` is required because DataGolf's historical
   * results endpoint is keyed by tour/event_id/year, not by event_id alone.
   */
  getTournamentResults(tournamentId: string, year: number): Promise<GolferResult[]>;
}
