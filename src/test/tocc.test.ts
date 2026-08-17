import { describe, expect, it } from "vitest";
import { computeTOCCWeek } from "../core/tocc.js";
import { pick, result } from "./fixtures.js";

const picks = [
  pick("p1", "t1", "g1"),
  pick("p2", "t1", "g2"),
  pick("p3", "t1", "g3"),
  pick("p4", "t1", "g4"),
];
const members = ["p1", "p2", "p3", "p4"];

describe("computeTOCCWeek", () => {
  it("charges $100/person to everyone but 1st and 2nd when the leader didn't win the event", () => {
    const results = [
      result("t1", "g1", 900, 2),
      result("t1", "g2", 500, 5),
      result("t1", "g3", 100, 20),
      result("t1", "g4", 0, null),
    ];
    const week = computeTOCCWeek("t1", members, picks, results);
    expect(week.winners).toEqual(["p1"]);
    expect(week.secondPlace).toEqual(["p2"]);
    expect(week.payments).toEqual([
      { from: "p3", to: "p1", amount: 100 },
      { from: "p4", to: "p1", amount: 100 },
    ]);
  });

  it("doubles the stake to $200/person when the winning pick won the tournament outright", () => {
    const results = [
      result("t1", "g1", 1800, 1),
      result("t1", "g2", 500, 5),
      result("t1", "g3", 100, 20),
      result("t1", "g4", 0, null),
    ];
    const week = computeTOCCWeek("t1", members, picks, results);
    expect(week.payments).toEqual([
      { from: "p3", to: "p1", amount: 200 },
      { from: "p4", to: "p1", amount: 200 },
    ]);
  });

  it("splits the stake evenly across tied 1st-place winners", () => {
    const results = [
      result("t1", "g1", 900, 2),
      result("t1", "g2", 900, 2),
      result("t1", "g3", 100, 20),
      result("t1", "g4", 0, null),
    ];
    const week = computeTOCCWeek("t1", members, picks, results);
    expect(week.winners.sort()).toEqual(["p1", "p2"]);
    expect(week.secondPlace).toEqual(["p3"]);
    expect(week.payments).toEqual([
      { from: "p4", to: "p1", amount: 50 },
      { from: "p4", to: "p2", amount: 50 },
    ]);
  });

  it("only ranks TOCC members, ignoring the rest of the league", () => {
    const results = [
      result("t1", "g1", 100, 30),
      result("t1", "g2", 50, 40),
      result("t1", "g3", 5000, 1), // p3 is not a TOCC member here
      result("t1", "g4", 0, null),
    ];
    const week = computeTOCCWeek("t1", ["p1", "p2", "p4"], picks, results);
    expect(week.rankings.map((r) => r.participantId)).toEqual(["p1", "p2", "p4"]);
    expect(week.winners).toEqual(["p1"]);
    expect(week.payments).toEqual([{ from: "p4", to: "p1", amount: 100 }]);
  });

  it("honours season-specific stakes", () => {
    const results = [
      result("t1", "g1", 900, 2),
      result("t1", "g2", 500, 5),
      result("t1", "g3", 100, 20),
      result("t1", "g4", 0, null),
    ];
    const week = computeTOCCWeek("t1", members, picks, results, { stake: 20, stakeIfWinner: 40 });
    expect(week.payments.every((p) => p.amount === 20)).toBe(true);
  });

  it("ranks a sole no-pick member at $0 rather than excluding them — no payments since they're also the only one", () => {
    const week = computeTOCCWeek("t1", ["px"], picks, []);
    expect(week.rankings).toEqual([{ participantId: "px", golferId: null, earnings: 0 }]);
    expect(week.winners).toEqual(["px"]);
    expect(week.payments).toEqual([]);
  });

  it("charges a no-pick member the stake like anyone else who didn't win or place", () => {
    const results = [
      result("t1", "g1", 900, 2),
      result("t1", "g2", 500, 5),
      result("t1", "g3", 100, 20),
      // g4/p4 has no result posted — irrelevant, since p5 below has no pick at all.
      result("t1", "g4", 0, null),
    ];
    const week = computeTOCCWeek("t1", [...members, "p5"], picks, results);
    expect(week.rankings).toContainEqual({ participantId: "p5", golferId: null, earnings: 0 });
    expect(week.winners).toEqual(["p1"]);
    expect(week.payments).toContainEqual({ from: "p5", to: "p1", amount: 100 });
  });
});
