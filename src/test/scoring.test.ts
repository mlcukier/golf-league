import { describe, expect, it } from "vitest";
import {
  buildEqualQuarterBoundaries,
  computeQuarterlyStandings,
  computeSeasonStandings,
} from "../core/scoring.js";
import { pick, result, tournament } from "./fixtures.js";

const tournaments = Array.from({ length: 8 }, (_, i) => tournament(`t${i + 1}`, i + 1));

const results = [
  result("t1", "g1", 1000, 1),
  result("t1", "g2", 100, 40),
  result("t3", "g1", 500, 3),
  result("t3", "g3", 2000, 1),
];

const picks = [
  pick("p1", "t1", "g1"),
  pick("p2", "t1", "g2"),
  pick("p1", "t3", "g3"),
  pick("p2", "t3", "g1"),
];

describe("computeSeasonStandings", () => {
  it("sums each participant's pick earnings, highest first", () => {
    expect(computeSeasonStandings(picks, results)).toEqual([
      { participantId: "p1", totalEarnings: 3000 }, // 1000 (g1@t1) + 2000 (g3@t3)
      { participantId: "p2", totalEarnings: 600 }, // 100 (g2@t1) + 500 (g1@t3)
    ]);
  });

  it("treats picks with no posted result as zero earnings", () => {
    expect(computeSeasonStandings([pick("p3", "t5", "g9")], results)).toEqual([
      { participantId: "p3", totalEarnings: 0 },
    ]);
  });
});

describe("buildEqualQuarterBoundaries", () => {
  it("splits 8 tournaments into 4 even quarters of 2", () => {
    expect(buildEqualQuarterBoundaries(tournaments)).toEqual([
      { quarter: 1, firstSequence: 1, lastSequence: 2 },
      { quarter: 2, firstSequence: 3, lastSequence: 4 },
      { quarter: 3, firstSequence: 5, lastSequence: 6 },
      { quarter: 4, firstSequence: 7, lastSequence: 8 },
    ]);
  });

  it("gives earlier quarters the extra event when the count isn't divisible by 4", () => {
    const boundaries = buildEqualQuarterBoundaries([...tournaments, tournament("t9", 9)]);
    expect(boundaries[0]).toEqual({ quarter: 1, firstSequence: 1, lastSequence: 3 });
    expect(boundaries[3]).toEqual({ quarter: 4, firstSequence: 8, lastSequence: 9 });
  });

  it("covers every tournament exactly once across the four quarters", () => {
    // 43 events is a realistic PGA season length and divides unevenly by 4.
    const many = Array.from({ length: 43 }, (_, i) => tournament(`t${i + 1}`, i + 1));
    const boundaries = buildEqualQuarterBoundaries(many);
    const covered = boundaries.flatMap((b) =>
      Array.from({ length: b.lastSequence - b.firstSequence + 1 }, (_, i) => b.firstSequence + i)
    );
    expect(covered).toEqual(Array.from({ length: 43 }, (_, i) => i + 1));
  });
});

describe("computeQuarterlyStandings", () => {
  it("scopes standings to each quarter's tournaments", () => {
    const boundaries = buildEqualQuarterBoundaries(tournaments); // t1-t2 = Q1, t3-t4 = Q2
    const byQuarter = computeQuarterlyStandings(picks, results, tournaments, boundaries);
    expect(byQuarter[1]).toEqual([
      { participantId: "p1", totalEarnings: 1000 },
      { participantId: "p2", totalEarnings: 100 },
    ]);
    expect(byQuarter[2]).toEqual([
      { participantId: "p1", totalEarnings: 2000 },
      { participantId: "p2", totalEarnings: 500 },
    ]);
  });
});
