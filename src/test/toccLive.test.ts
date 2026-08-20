import { describe, expect, it } from "vitest";
import { buildTOCCLiveStandings, estimateTOCCWeekFromLive } from "../core/toccLive.js";
import type { LiveInPlayRow } from "../providers/dataGolfLive.js";
import { emptyLeagueData, type LeagueData } from "../store/store.js";
import { pick } from "./fixtures.js";
import type { Golfer } from "../types.js";

function golfer(id: string, name: string): Golfer {
  return { id, name };
}

function liveRow(overrides: Partial<LiveInPlayRow> = {}): LiveInPlayRow {
  return {
    playerName: "Scheffler, Scottie",
    round: 4,
    thru: 18,
    endHole: 18,
    currentPos: "1",
    currentScore: -17,
    ...overrides,
  };
}

function baseData(overrides: Partial<LeagueData> = {}): LeagueData {
  return {
    ...emptyLeagueData(),
    golfers: [golfer("g1", "Scottie Scheffler"), golfer("g2", "Sam Burns"), golfer("g3", "Alex Noren")],
    ...overrides,
  };
}

describe("buildTOCCLiveStandings", () => {
  it("sorts by current score, best first, matching picks to live rows across First-Last / Last-First formats", () => {
    const data = baseData({
      picks: [pick("p1", "t1", "g1"), pick("p2", "t1", "g2"), pick("p3", "t1", "g3")],
    });
    const liveRows = [
      liveRow({ playerName: "Scheffler, Scottie", currentPos: "1", currentScore: -17 }),
      liveRow({ playerName: "Burns, Sam", currentPos: "T3", currentScore: -8 }),
      liveRow({ playerName: "Noren, Alex", currentPos: "T3", currentScore: -8 }),
    ];
    const standings = buildTOCCLiveStandings(data, ["p1", "p2", "p3"], data.picks, liveRows);
    // p2 (Burns) and p3 (Noren) are tied at -8; ties break alphabetically by golfer name, so Noren sorts first.
    expect(standings.map((s) => s.participantId)).toEqual(["p1", "p3", "p2"]);
    expect(standings[0]).toMatchObject({ golferName: "Scottie Scheffler", currentPos: "1", currentScore: -17 });
  });

  it("sinks a participant with no live row (name mismatch or out of the event) to the bottom", () => {
    const data = baseData({
      golfers: [...baseData().golfers, golfer("g4", "Some Rando")],
      picks: [pick("p1", "t1", "g1"), pick("p2", "t1", "g4")],
    });
    const liveRows = [liveRow({ playerName: "Scheffler, Scottie", currentScore: -17 })];
    const standings = buildTOCCLiveStandings(data, ["p1", "p2"], data.picks, liveRows);
    expect(standings.map((s) => s.participantId)).toEqual(["p1", "p2"]);
    expect(standings[1]).toMatchObject({ golferName: "Some Rando", currentPos: null, currentScore: null });
  });

  it("shows null for a participant with no pick at all", () => {
    const data = baseData({ picks: [pick("p1", "t1", "g1")] });
    const standings = buildTOCCLiveStandings(data, ["p1", "p2"], data.picks, [liveRow()]);
    const noPickRow = standings.find((s) => s.participantId === "p2");
    expect(noPickRow).toMatchObject({ golferName: null, currentPos: null, currentScore: null });
  });
});

describe("estimateTOCCWeekFromLive", () => {
  it("ranks by live score and picks a winner, same shape as the official computeTOCCWeek", () => {
    const data = baseData({
      picks: [pick("p1", "t1", "g1"), pick("p2", "t1", "g2"), pick("p3", "t1", "g3")],
    });
    const liveRows = [
      liveRow({ playerName: "Scheffler, Scottie", currentPos: "1", currentScore: -17 }),
      liveRow({ playerName: "Burns, Sam", currentPos: "T5", currentScore: -8 }),
      liveRow({ playerName: "Noren, Alex", currentPos: "CUT", currentScore: null }),
    ];
    const week = estimateTOCCWeekFromLive(data, ["p1", "p2", "p3"], data.picks, liveRows, "t1", {
      stake: 100,
      stakeIfWinner: 200,
    });
    expect(week.winners).toEqual(["p1"]);
    // Scheffler is the outright live leader ("1", not "T1") — stake doubles
    // to $200, but p2 is solo 2nd so still gets the base-$100 break (same
    // rule computeTOCCWeek already applies to official results).
    expect(week.payments.sort((a, b) => a.from.localeCompare(b.from))).toEqual([
      { from: "p2", to: "p1", amount: 100 },
      { from: "p3", to: "p1", amount: 200 },
    ]);
  });

  it("treats a picked golfer with no live row as a $0 week, never mistaken for a leader or 2nd place", () => {
    const data = baseData({
      picks: [pick("p1", "t1", "g1"), pick("p2", "t1", "g2"), pick("p3", "t1", "g3")],
    });
    // g1 and g2 show up live; g3 is presumably cut / name-mismatched — no row at all.
    const liveRows = [
      liveRow({ playerName: "Scheffler, Scottie", currentPos: "1", currentScore: -17 }),
      liveRow({ playerName: "Burns, Sam", currentPos: "T5", currentScore: -8 }),
    ];
    const week = estimateTOCCWeekFromLive(data, ["p1", "p2", "p3"], data.picks, liveRows, "t1", {
      stake: 100,
      stakeIfWinner: 200,
    });
    expect(week.winners).toEqual(["p1"]);
    // p2 is solo 2nd (break-even on the base stake); p3, with no live data
    // at all, ranks dead last and pays the full doubled stake like anyone
    // else outside the top 2.
    expect(week.payments.sort((a, b) => a.from.localeCompare(b.from))).toEqual([
      { from: "p2", to: "p1", amount: 100 },
      { from: "p3", to: "p1", amount: 200 },
    ]);
  });
});
