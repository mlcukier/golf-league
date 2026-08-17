import { describe, expect, it } from "vitest";
import { distributePlacePayouts, payoutSchedulePct } from "../core/payouts.js";
import type { PayoutPlace } from "../types.js";

// The league's real schedule: 20 players @ $750 = $15,000 pot.
// Overall pays $4,750 / $2,250 / $1,000 for 1st/2nd/3rd.
const overall: PayoutPlace[] = [
  { place: 1, pct: 4750 / 15000 },
  { place: 2, pct: 2250 / 15000 },
  { place: 3, pct: 1000 / 15000 },
];
const POT = 15000;

const standings = [
  { participantId: "p1", totalEarnings: 500000 },
  { participantId: "p2", totalEarnings: 400000 },
  { participantId: "p3", totalEarnings: 300000 },
  { participantId: "p4", totalEarnings: 200000 },
];

describe("distributePlacePayouts", () => {
  it("pays exactly the configured dollar amounts with no ties", () => {
    const rows = distributePlacePayouts(standings, overall, POT);
    expect(rows).toEqual([
      { participantId: "p1", amount: 4750 },
      { participantId: "p2", amount: 2250 },
      { participantId: "p3", amount: 1000 },
    ]);
  });

  it("leaves anyone outside the paid places with no payout row", () => {
    const rows = distributePlacePayouts(standings, overall, POT);
    expect(rows.find((r) => r.participantId === "p4")).toBeUndefined();
  });

  it("combines and splits evenly across a tie for 1st", () => {
    const tied = [
      { participantId: "p1", totalEarnings: 500000 },
      { participantId: "p2", totalEarnings: 500000 },
      { participantId: "p3", totalEarnings: 300000 },
    ];
    const rows = distributePlacePayouts(tied, overall, POT);
    // 1st+2nd place money (4750+2250=7000) split between the two tied leaders;
    // p3 drops to 3rd place money.
    expect(rows).toEqual([
      { participantId: "p1", amount: 3500 },
      { participantId: "p2", amount: 3500 },
      { participantId: "p3", amount: 1000 },
    ]);
  });

  it("pays nothing for places beyond a tie group that overruns the schedule", () => {
    // A 4-way tie for 1st against a schedule that only pays 3 places: only
    // places 1-3's money is on the table, split 4 ways.
    const tied = standings.map((s) => ({ ...s, totalEarnings: 100 }));
    const rows = distributePlacePayouts(tied, overall, POT);
    const total = rows.reduce((sum, r) => sum + r.amount, 0);
    expect(total).toBeCloseTo(4750 + 2250 + 1000, 5);
    expect(rows).toHaveLength(4);
    expect(rows[0]!.amount).toBeCloseTo((4750 + 2250 + 1000) / 4, 5);
  });

  it("scales automatically with a different total pot, preserving the ratio", () => {
    const rows = distributePlacePayouts(standings, overall, POT * 2);
    expect(rows[0]!.amount).toBe(9500);
  });

  it("returns nothing for an empty schedule or empty standings", () => {
    expect(distributePlacePayouts(standings, [], POT)).toEqual([]);
    expect(distributePlacePayouts([], overall, POT)).toEqual([]);
  });
});

describe("payoutSchedulePct", () => {
  it("overall + 4 quarters sums to 100% of the pot for the real schedule", () => {
    const quarter: PayoutPlace[] = [
      { place: 1, pct: 1250 / 15000 },
      { place: 2, pct: 500 / 15000 },
    ];
    expect(payoutSchedulePct(overall) + 4 * payoutSchedulePct(quarter)).toBeCloseTo(1, 10);
  });
});
