import { describe, expect, it } from "vitest";
import { buildSeasonReport } from "../core/report.js";
import { emptyLeagueData, type LeagueData } from "../store/store.js";
import { pick, result, tournament } from "./fixtures.js";
import type { League, Participant, Season } from "../types.js";

const LEAGUE_ID = "lg1";
const SEASON_ID = "s2026";

function baseData(overrides: Partial<LeagueData> = {}): LeagueData {
  const league: League = { id: LEAGUE_ID, name: "Real League", isTest: false, createdAt: "2026-01-01T00:00:00Z" };
  const season: Season = {
    id: SEASON_ID,
    leagueId: LEAGUE_ID,
    year: 2026,
    status: "ACTIVE",
    startDate: "2026-01-01",
    endDate: null,
    grellerWeeklyContribution: 10,
    missedCutFine: 50,
    toccStake: 100,
    toccStakeIfWinner: 200,
  };
  const participants: Participant[] = [
    { id: "p1", name: "A", email: "a@example.com" },
    { id: "p2", name: "B", email: "b@example.com" },
    { id: "p3", name: "C", email: "c@example.com" },
  ];
  return {
    ...emptyLeagueData(),
    leagues: [league],
    seasons: [season],
    participants,
    seasonEntries: participants.map((p) => ({ seasonId: SEASON_ID, participantId: p.id, isTOCCMember: false })),
    ...overrides,
  };
}

describe("buildSeasonReport — Greller", () => {
  it("shows the full roster's ante for the current week before any results are posted", () => {
    const data = baseData({
      tournaments: [tournament("t1", 1)],
      picks: [pick("p1", "t1", "g1"), pick("p2", "t1", "g2")], // p3 hasn't picked yet
    });
    const report = buildSeasonReport(data, data.seasons[0]!);
    // 3 roster members * $10, regardless of who has actually submitted a pick.
    expect(report.greller.currentBalance).toBe(30);
    expect(report.greller.history).toHaveLength(1);
  });

  it("does not pull in future weeks that haven't opened yet", () => {
    const data = baseData({
      tournaments: [tournament("t1", 1), tournament("t2", 2)],
      picks: [],
    });
    const report = buildSeasonReport(data, data.seasons[0]!);
    expect(report.greller.history).toHaveLength(1); // only t1, the open one
    expect(report.greller.currentBalance).toBe(30);
  });

  it("still accrues correctly once a week's results are posted and it rolls over", () => {
    const data = baseData({
      tournaments: [tournament("t1", 1), tournament("t2", 2)],
      picks: [pick("p1", "t1", "g1"), pick("p2", "t1", "g1")], // tie on the winner -> rollover
      results: [result("t1", "g1", 1000, 1)],
    });
    const report = buildSeasonReport(data, data.seasons[0]!);
    // t1 rolled over (30) + t2 (the new open week) ante (30) = 60.
    expect(report.greller.history).toHaveLength(2);
    expect(report.greller.currentBalance).toBe(60);
  });
});
