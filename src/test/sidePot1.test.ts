import { describe, expect, it } from "vitest";
import {
  computeSidePot1Balance,
  computeSidePot1Tallies,
  determineSidePot1Winners,
} from "../core/sidePot1.js";
import { pick, result } from "./fixtures.js";

const picks = [
  pick("p1", "t1", "g1"),
  pick("p2", "t1", "g2"),
  pick("p1", "t2", "g3"),
  pick("p2", "t2", "g4"),
];

const results = [
  result("t1", "g1", 1000, 1), // p1 win
  result("t1", "g2", 0, null), // p2 missed cut
  result("t2", "g3", 200, 8), // p1 top 10
  result("t2", "g4", 0, null), // p2 missed cut
];

describe("computeSidePot1Balance", () => {
  it("charges the fine per missed cut and ignores made cuts", () => {
    expect(computeSidePot1Balance(picks, results)).toBe(100); // p2 missed twice
  });

  it("honours a season-specific fine", () => {
    expect(computeSidePot1Balance(picks, results, 25)).toBe(50);
  });

  it("ignores picks whose tournament hasn't posted results yet", () => {
    expect(computeSidePot1Balance([pick("p1", "t9", "g9")], results)).toBe(0);
  });
});

describe("computeSidePot1Tallies + determineSidePot1Winners", () => {
  it("crowns the participant with the most top-10 picks", () => {
    const winners = determineSidePot1Winners(computeSidePot1Tallies(picks, results));
    expect(winners).toEqual([{ participantId: "p1", missedCuts: 0, top10s: 2, top5s: 1, wins: 1 }]);
  });

  it("breaks a top-10 tie using top-5s", () => {
    const tallies = [
      { participantId: "a", missedCuts: 0, top10s: 3, top5s: 1, wins: 0 },
      { participantId: "b", missedCuts: 0, top10s: 3, top5s: 2, wins: 0 },
    ];
    expect(determineSidePot1Winners(tallies)).toEqual([
      { participantId: "b", missedCuts: 0, top10s: 3, top5s: 2, wins: 0 },
    ]);
  });

  it("falls through to most wins when top-10s and top-5s are level", () => {
    const tallies = [
      { participantId: "a", missedCuts: 0, top10s: 3, top5s: 2, wins: 0 },
      { participantId: "b", missedCuts: 0, top10s: 3, top5s: 2, wins: 1 },
    ];
    expect(determineSidePot1Winners(tallies)).toEqual([
      { participantId: "b", missedCuts: 0, top10s: 3, top5s: 2, wins: 1 },
    ]);
  });

  it("splits the pot on a true tie across every tiebreaker", () => {
    const tallies = [
      { participantId: "a", missedCuts: 1, top10s: 2, top5s: 1, wins: 1 },
      { participantId: "b", missedCuts: 2, top10s: 2, top5s: 1, wins: 1 },
    ];
    expect(determineSidePot1Winners(tallies)).toEqual(tallies);
  });
});
