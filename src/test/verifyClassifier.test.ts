import { describe, expect, it } from "vitest";
// @ts-expect-error - plain .mjs helper script, no type declarations
import { classifyRow, numeric } from "../../scripts/verify-datagolf.mjs";

/**
 * The verify script's whole job is telling REAL PRIZE MONEY apart from FedEx
 * Cup points. These cases pin that distinction using realistic magnitudes:
 * a PGA winner takes home $1-4M but scores only ~500-750 FedEx points.
 */
describe("classifyRow", () => {
  it("identifies genuine prize money on a winner's row", () => {
    const out = classifyRow({
      player_name: "Scheffler, Scottie",
      fin_text: "1",
      earnings: 3600000,
      fedex_points: 700,
      dg_points: 512,
    });
    expect(out.verdict).toBe("MONEY");
    expect(out.moneyFields).toEqual(["earnings"]);
    expect(out.pointsFields).toEqual(["fedex_points", "dg_points"]);
    expect(out.credible).toEqual([["earnings", 3600000]]);
  });

  it("reports NONE when the row carries only points", () => {
    const out = classifyRow({
      player_name: "Scheffler, Scottie",
      fin_text: "1",
      fedex_points: 700,
      dg_points: 512,
    });
    expect(out.verdict).toBe("NONE");
    expect(out.moneyFields).toEqual([]);
  });

  it("flags a money-named field as SUSPECT when it's too small to be winnings", () => {
    // A zero-filled or points-valued column on a lower tier must not be
    // mistaken for prize money.
    const out = classifyRow({ player_name: "X", fin_text: "1", earnings: 0 });
    expect(out.verdict).toBe("SUSPECT");

    const pointsInMoneyField = classifyRow({ player_name: "X", fin_text: "1", money: 700 });
    expect(pointsInMoneyField.verdict).toBe("SUSPECT");
  });

  it("accepts alternative money key names", () => {
    for (const key of ["money", "prize_money", "purse_won", "winnings", "payout"]) {
      expect(classifyRow({ fin_text: "1", [key]: 1500000 }).verdict).toBe("MONEY");
    }
  });

  it("does not classify a fedex_points_earned column as money", () => {
    // Contains "earn" AND "point" — points must win, or the magnitude check
    // would be the only thing standing between us and a wrong answer.
    const out = classifyRow({ fin_text: "1", fedex_points_earned: 700 });
    expect(out.credible).toEqual([]);
    expect(out.verdict).not.toBe("MONEY");
  });
});

describe("numeric", () => {
  it("parses formatted currency and plain numbers", () => {
    expect(numeric("$1,350,000")).toBe(1350000);
    expect(numeric(1350000)).toBe(1350000);
    expect(numeric("1350000")).toBe(1350000);
  });

  it("returns null for non-numeric values", () => {
    expect(numeric("CUT")).toBeNull();
    expect(numeric(null)).toBeNull();
    expect(numeric(undefined)).toBeNull();
  });
});
