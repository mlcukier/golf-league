import { describe, expect, it } from "vitest";
import { computeGrellerHistory } from "../core/greller.js";
import { pick, result, tournament } from "./fixtures.js";

const t1 = tournament("t1", 1);
const t2 = tournament("t2", 2);

describe("computeGrellerHistory", () => {
  it("pays out and resets when exactly one participant picked the winner", () => {
    const picks = [pick("p1", "t1", "g1"), pick("p2", "t1", "g2")];
    const results = [result("t1", "g1", 1000, 1)];
    const [week] = computeGrellerHistory([t1], picks, results, 3);
    expect(week).toEqual({
      tournamentId: "t1",
      contribution: 30,
      winnerParticipantId: "p1",
      amountWon: 30,
      potBalanceAfter: 0,
    });
  });

  it("rolls the pot over when two participants both picked the winner", () => {
    const picks = [pick("p1", "t1", "g1"), pick("p2", "t1", "g1")];
    const results = [result("t1", "g1", 1000, 1)];
    const [week] = computeGrellerHistory([t1], picks, results, 3);
    expect(week).toEqual({
      tournamentId: "t1",
      contribution: 30,
      winnerParticipantId: null,
      amountWon: null,
      potBalanceAfter: 30,
    });
  });

  it("rolls over when nobody picked the winner at all", () => {
    const picks = [pick("p1", "t1", "g5"), pick("p2", "t1", "g6")];
    const results = [result("t1", "g1", 1000, 1)];
    const [week] = computeGrellerHistory([t1], picks, results, 3);
    expect(week!.winnerParticipantId).toBeNull();
    expect(week!.potBalanceAfter).toBe(30);
  });

  it("keeps accruing across weeks until someone wins it uniquely", () => {
    const picks = [
      pick("p1", "t1", "g1"),
      pick("p2", "t1", "g1"),
      pick("p1", "t2", "g3"),
      pick("p2", "t2", "g4"),
    ];
    const results = [result("t1", "g1", 1000, 1), result("t2", "g3", 1000, 1)];
    const history = computeGrellerHistory([t1, t2], picks, results, 3);
    expect(history[0]!.potBalanceAfter).toBe(30); // t1 tie -> rollover
    // t2: 30 rolled over + 30 new = 60 paid to p1, pot resets.
    expect(history[1]).toEqual({
      tournamentId: "t2",
      contribution: 30,
      winnerParticipantId: "p1",
      amountWon: 60,
      potBalanceAfter: 0,
    });
  });

  it("honours a season-specific weekly contribution", () => {
    const [week] = computeGrellerHistory([t1], [], [], 4, 25);
    expect(week!.contribution).toBe(100);
  });
});
