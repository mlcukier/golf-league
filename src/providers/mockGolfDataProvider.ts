import type { Golfer, GolferResult, Tournament } from "../types.js";
import type { GolfDataProvider } from "./golfDataProvider.js";

/**
 * In-memory stand-in for a live golf stats API, for local development and
 * tests before a real provider (SportsData.io, Sportradar, etc.) is wired up.
 */
export class MockGolfDataProvider implements GolfDataProvider {
  constructor(
    private schedule: Tournament[],
    private fieldsByTournament: Map<string, Golfer[]>,
    private resultsByTournament: Map<string, GolferResult[]>
  ) {}

  async getSeasonSchedule(): Promise<Tournament[]> {
    return this.schedule;
  }

  async getTournamentField(tournamentId: string): Promise<Golfer[]> {
    return this.fieldsByTournament.get(tournamentId) ?? [];
  }

  async getTournamentResults(tournamentId: string): Promise<GolferResult[]> {
    return this.resultsByTournament.get(tournamentId) ?? [];
  }
}
