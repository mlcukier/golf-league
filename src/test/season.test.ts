import { describe, expect, it } from "vitest";
import {
  createSeason,
  createTestLeague,
  selectSeasonTournaments,
  startNewSeason,
} from "../core/season.js";
import { validatePick } from "../core/oneAndDone.js";
import { pick, tournament } from "./fixtures.js";
import type { SeasonEntry } from "../types.js";

describe("createSeason", () => {
  it("opens on Jan 1 of the season year by default", () => {
    const season = createSeason({ id: "s1", leagueId: "lg1", year: 2026 });
    expect(season.startDate).toBe("2026-01-01");
    expect(season.status).toBe("DRAFT");
    expect(season.missedCutFine).toBe(50);
  });

  it("accepts per-season money overrides", () => {
    const season = createSeason({ id: "s1", leagueId: "lg1", year: 2026, rules: { toccStake: 0 } });
    expect(season.toccStake).toBe(0);
    expect(season.grellerWeeklyContribution).toBe(10); // untouched
  });
});

describe("createTestLeague", () => {
  it("creates an isolated test league running from today to year end", () => {
    const { league, season } = createTestLeague("lg-t", "sn-t", new Date("2026-08-16T00:00:00Z"));
    expect(league.isTest).toBe(true);
    expect(season.year).toBe(2026);
    expect(season.startDate).toBe("2026-08-16");
  });

  it("can run for no money at all", () => {
    const { season } = createTestLeague("lg-t", "sn-t", new Date("2026-08-16T00:00:00Z"), {
      grellerWeeklyContribution: 0,
      missedCutFine: 0,
      toccStake: 0,
      toccStakeIfWinner: 0,
    });
    expect(season.missedCutFine).toBe(0);
  });
});

describe("startNewSeason", () => {
  const previous = createSeason({ id: "s2026", leagueId: "lg1", year: 2026, rules: { missedCutFine: 75 } });
  const roster: SeasonEntry[] = [
    { seasonId: "s2026", participantId: "p1", isTOCCMember: true },
    { seasonId: "s2026", participantId: "p2", isTOCCMember: false },
  ];

  it("carries the roster and money rules into the new year", () => {
    const { season, entries } = startNewSeason(previous, "s2027", 2027, roster);
    expect(season.year).toBe(2027);
    expect(season.leagueId).toBe("lg1");
    expect(season.missedCutFine).toBe(75);
    expect(entries).toEqual([
      { seasonId: "s2027", participantId: "p1", isTOCCMember: true },
      { seasonId: "s2027", participantId: "p2", isTOCCMember: false },
    ]);
  });

  it("resets the one-and-done pool — last year's golfers are pickable again", () => {
    const { season } = startNewSeason(previous, "s2027", 2027, roster);
    const lastYear = pick("p1", "t1", "g1", { seasonId: previous.id });

    expect(
      validatePick({
        participantId: "p1",
        seasonId: season.id,
        tournamentId: "t2027-1",
        golferId: "g1",
        receivedAt: "2027-01-05T00:00:00Z",
        tournamentStartTime: "2027-01-07T13:00:00Z",
        existingPicks: [lastYear],
        tournamentField: new Set(["g1"]),
      }).ok
    ).toBe(true);
  });
});

describe("selectSeasonTournaments", () => {
  const season = createSeason({ id: "s2026", leagueId: "lg1", year: 2026 });

  it("re-sequences eligible tournaments 1..N and stops at the finale", () => {
    const candidates = [
      tournament("a", 1),
      tournament("b", 2),
      tournament("c", 3, { isSeasonFinale: true }),
      tournament("d", 4), // the actual last event of the year — excluded
    ];
    const selected = selectSeasonTournaments(season, candidates);
    expect(selected.map((t) => t.id)).toEqual(["a", "b", "c"]);
    expect(selected.map((t) => t.sequence)).toEqual([1, 2, 3]);
    expect(selected.every((t) => t.seasonId === "s2026")).toBe(true);
  });

  it("excludes tournaments starting before the season start date", () => {
    const midYear = createSeason({
      id: "s-test",
      leagueId: "lg1",
      year: 2026,
      startDate: "2026-08-16",
    });
    const candidates = [
      tournament("early", 1, { startTime: "2026-03-01T13:00:00Z" }),
      tournament("late", 2, { startTime: "2026-09-01T13:00:00Z" }),
    ];
    expect(selectSeasonTournaments(midYear, candidates).map((t) => t.id)).toEqual(["late"]);
  });
});
