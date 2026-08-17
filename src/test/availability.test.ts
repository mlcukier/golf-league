import { describe, expect, it } from "vitest";
import { computeGolferAvailability, getAvailability } from "../core/availability.js";
import { pick } from "./fixtures.js";

const roster = ["p1", "p2", "p3", "p4"];

describe("computeGolferAvailability", () => {
  it("is absent from the map (fully available) for a golfer nobody's ever picked", () => {
    const availability = computeGolferAvailability([], roster, "t-current");
    expect(availability.get("g1")).toBeUndefined();
  });

  it("counts distinct cohort members who used the golfer in a previous tournament", () => {
    const picks = [pick("p1", "t1", "g1"), pick("p2", "t2", "g1")];
    const availability = computeGolferAvailability(picks, roster, "t-current");
    expect(availability.get("g1")).toEqual({ available: 2, total: 4 });
  });

  it("excludes picks for the current tournament entirely, even if several people already picked it this week", () => {
    const picks = [
      pick("p1", "t-current", "g1"),
      pick("p2", "t-current", "g1"),
      pick("p3", "t-current", "g1"),
    ];
    const availability = computeGolferAvailability(picks, roster, "t-current");
    expect(availability.get("g1")).toBeUndefined();
  });

  it("only counts previous usage, ignoring any pick for the current week on top of it", () => {
    const picks = [pick("p1", "t1", "g1"), pick("p2", "t-current", "g1")];
    const availability = computeGolferAvailability(picks, roster, "t-current");
    expect(availability.get("g1")).toEqual({ available: 3, total: 4 });
  });

  it("ignores picks from participants outside the cohort", () => {
    const picks = [pick("off-roster", "t1", "g1")];
    const availability = computeGolferAvailability(picks, roster, "t-current");
    expect(availability.get("g1")).toBeUndefined();
  });

  it("returns 0 available once every cohort member has used the golfer", () => {
    const picks = roster.map((p, i) => pick(p, "t" + i, "g1"));
    const availability = computeGolferAvailability(picks, roster, "t-current");
    expect(availability.get("g1")).toEqual({ available: 0, total: 4 });
  });

  it("returns an empty map for an empty cohort", () => {
    const availability = computeGolferAvailability([pick("p1", "t1", "g1")], [], "t-current");
    expect(availability.size).toBe(0);
  });

  it("supports a smaller, arbitrary cohort — not just the whole roster", () => {
    const picks = [pick("p1", "t1", "g1"), pick("p3", "t1", "g1")];
    const availability = computeGolferAvailability(picks, ["p1", "p2"], "t-current"); // p3 isn't in this cohort
    expect(availability.get("g1")).toEqual({ available: 1, total: 2 });
  });
});

describe("getAvailability", () => {
  it("returns the entry when present", () => {
    const map = new Map([["g1", { available: 2, total: 4 }]]);
    expect(getAvailability(map, "g1", 4)).toEqual({ available: 2, total: 4 });
  });

  it("defaults to fully available when absent", () => {
    const map = new Map();
    expect(getAvailability(map, "g1", 4)).toEqual({ available: 4, total: 4 });
  });
});
