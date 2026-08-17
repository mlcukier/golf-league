import { describe, expect, it } from "vitest";
import { emptyLeagueData, findGolferByName, upsertGolfer } from "../store/store.js";

describe("findGolferByName", () => {
  it("matches regardless of case", () => {
    const data = { ...emptyLeagueData(), golfers: [{ id: "g1", name: "Scheffler, Scottie" }] };
    expect(findGolferByName(data, "SCHEFFLER, SCOTTIE")?.id).toBe("g1");
  });

  it("matches 'First Last' against a stored 'Last, First' record", () => {
    // The exact real-world collision this guards against: a DataGolf field
    // pull stores "Scheffler, Scottie", but free-text pick/results entry
    // (or a Hearn list, or an admin override) types "Scottie Scheffler" —
    // without this, that becomes a second Golfer id for the same person and
    // silently defeats one-and-done, Side Pot tallies, and Hearn matching.
    const data = { ...emptyLeagueData(), golfers: [{ id: "g1", name: "Scheffler, Scottie" }] };
    expect(findGolferByName(data, "Scottie Scheffler")?.id).toBe("g1");
  });

  it("matches 'Last, First' against a stored 'First Last' record", () => {
    const data = { ...emptyLeagueData(), golfers: [{ id: "g1", name: "Scottie Scheffler" }] };
    expect(findGolferByName(data, "Scheffler, Scottie")?.id).toBe("g1");
  });

  it("still falls back to substring matching for a partial name", () => {
    const data = { ...emptyLeagueData(), golfers: [{ id: "g1", name: "Kim, Si Woo" }] };
    expect(findGolferByName(data, "Si Woo")?.id).toBe("g1");
  });
});

describe("upsertGolfer", () => {
  it("reuses the existing golfer instead of creating a transposed duplicate", () => {
    const data = { ...emptyLeagueData(), golfers: [{ id: "g1", name: "Scheffler, Scottie" }] };
    const golfer = upsertGolfer(data, "Scottie Scheffler");
    expect(golfer.id).toBe("g1");
    expect(data.golfers).toHaveLength(1);
  });
});
