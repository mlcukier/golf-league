import { describe, expect, it } from "vitest";
import { computeGolferAvailability } from "../core/availability.js";
import { pick } from "./fixtures.js";

const roster = ["p1", "p2", "p3", "p4"];

describe("computeGolferAvailability", () => {
  it("is 100% available (absent from the map) for a golfer nobody's ever picked", () => {
    const availability = computeGolferAvailability([], roster, "t-current");
    expect(availability.get("g1")).toBeUndefined();
  });

  it("counts distinct roster members who used the golfer in a previous tournament", () => {
    const picks = [pick("p1", "t1", "g1"), pick("p2", "t2", "g1")];
    const availability = computeGolferAvailability(picks, roster, "t-current");
    // 2 of 4 roster members have used g1 -> 50% still available.
    expect(availability.get("g1")).toBe(50);
  });

  it("excludes picks for the current tournament entirely, even if several people already picked it this week", () => {
    const picks = [
      pick("p1", "t-current", "g1"),
      pick("p2", "t-current", "g1"),
      pick("p3", "t-current", "g1"),
    ];
    const availability = computeGolferAvailability(picks, roster, "t-current");
    expect(availability.get("g1")).toBeUndefined(); // no PREVIOUS usage at all -> still 100%, not in the map
  });

  it("only counts previous usage, ignoring any pick for the current week on top of it", () => {
    const picks = [pick("p1", "t1", "g1"), pick("p2", "t-current", "g1")];
    const availability = computeGolferAvailability(picks, roster, "t-current");
    // Only p1's prior-week pick counts; p2's current-week pick is excluded.
    expect(availability.get("g1")).toBe(75);
  });

  it("ignores picks from participants no longer on the roster", () => {
    const picks = [pick("off-roster", "t1", "g1")];
    const availability = computeGolferAvailability(picks, roster, "t-current");
    expect(availability.get("g1")).toBeUndefined();
  });

  it("returns 0% once every roster member has used the golfer", () => {
    const picks = roster.map((p, i) => pick(p, "t" + i, "g1"));
    const availability = computeGolferAvailability(picks, roster, "t-current");
    expect(availability.get("g1")).toBe(0);
  });

  it("returns an empty map for an empty roster", () => {
    const availability = computeGolferAvailability([pick("p1", "t1", "g1")], [], "t-current");
    expect(availability.size).toBe(0);
  });
});
