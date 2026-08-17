import { describe, expect, it } from "vitest";
import {
  blockingReasons,
  usedGolferIds,
  validatePick,
  type ValidatePickInput,
} from "../core/oneAndDone.js";
import { pick, SEASON_ID } from "./fixtures.js";

const START = "2026-02-12T13:00:00Z"; // round 1 tee-off == the deadline

const baseInput: ValidatePickInput = {
  participantId: "p1",
  seasonId: SEASON_ID,
  tournamentId: "t2",
  golferId: "g2",
  receivedAt: "2026-02-10T08:00:00Z",
  tournamentStartTime: START,
  existingPicks: [],
  tournamentField: new Set(["g1", "g2", "g3"]),
};

describe("validatePick", () => {
  it("accepts a fresh, in-field pick received before the start time", () => {
    const result = validatePick(baseInput);
    expect(result.ok).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it("rejects a golfer already used earlier this season", () => {
    const result = validatePick({ ...baseInput, existingPicks: [pick("p1", "t1", "g2")] });
    expect(result.ok).toBe(false);
    expect(result.reasons).toEqual(["GOLFER_ALREADY_USED"]);
    expect(result.previouslyUsedInTournamentId).toBe("t1");
  });

  it("allows a golfer another participant already used (one-and-done is per participant)", () => {
    expect(validatePick({ ...baseInput, existingPicks: [pick("p2", "t1", "g2")] }).ok).toBe(true);
  });

  it("allows reusing a golfer burned in a DIFFERENT season", () => {
    const lastYear = pick("p1", "t1", "g2", { seasonId: "s2025" });
    expect(validatePick({ ...baseInput, existingPicks: [lastYear] }).ok).toBe(true);
  });

  it("rejects a second pick for the same week", () => {
    const result = validatePick({ ...baseInput, existingPicks: [pick("p1", "t2", "g1")] });
    expect(result.reasons).toEqual(["ALREADY_PICKED_THIS_WEEK"]);
  });

  it("rejects a golfer not in this week's field", () => {
    expect(validatePick({ ...baseInput, golferId: "nobody" }).reasons).toEqual(["GOLFER_NOT_IN_FIELD"]);
  });

  it("rejects a pick received after the tournament has started", () => {
    expect(validatePick({ ...baseInput, receivedAt: "2026-02-12T13:00:01Z" }).reasons).toEqual([
      "PAST_DEADLINE",
    ]);
  });

  it("rejects a pick received exactly at the start time — the deadline is exclusive", () => {
    expect(validatePick({ ...baseInput, receivedAt: START }).reasons).toEqual(["PAST_DEADLINE"]);
  });

  it("accepts a pick received one second before the start time", () => {
    expect(validatePick({ ...baseInput, receivedAt: "2026-02-12T12:59:59Z" }).ok).toBe(true);
  });

  it("reports EVERY violation, not just the first", () => {
    const result = validatePick({
      ...baseInput,
      existingPicks: [pick("p1", "t1", "g2")], // g2 already used
      receivedAt: "2026-02-20T00:00:00Z", // and it's late
    });
    expect(result.reasons).toContain("GOLFER_ALREADY_USED");
    expect(result.reasons).toContain("PAST_DEADLINE");
  });
});

describe("blockingReasons", () => {
  it("lets an admin force a late pick", () => {
    const validation = validatePick({ ...baseInput, receivedAt: "2026-02-20T00:00:00Z" });
    expect(blockingReasons(validation, true)).toEqual([]);
  });

  it("lets an admin force a golfer who isn't in the listed field", () => {
    const validation = validatePick({ ...baseInput, golferId: "nobody" });
    expect(blockingReasons(validation, true)).toEqual([]);
  });

  it("NEVER lets force bypass one-and-done, even alongside an overridable reason", () => {
    // Regression: validatePick used to stop at the first failure, so a forced
    // PAST_DEADLINE hid the duplicate golfer and the pick was accepted.
    const validation = validatePick({
      ...baseInput,
      existingPicks: [pick("p1", "t1", "g2")], // g2 burned in week 1
      receivedAt: "2026-02-20T00:00:00Z", // late, and force-able
    });
    expect(blockingReasons(validation, true)).toEqual(["GOLFER_ALREADY_USED"]);
  });

  it("never lets force bypass a duplicate pick for the same week", () => {
    const validation = validatePick({
      ...baseInput,
      existingPicks: [pick("p1", "t2", "g1")],
      receivedAt: "2026-02-20T00:00:00Z",
    });
    expect(blockingReasons(validation, true)).toEqual(["ALREADY_PICKED_THIS_WEEK"]);
  });

  it("blocks everything when force is off", () => {
    const validation = validatePick({ ...baseInput, receivedAt: "2026-02-20T00:00:00Z" });
    expect(blockingReasons(validation, false)).toEqual(["PAST_DEADLINE"]);
  });
});

describe("usedGolferIds", () => {
  it("returns only the given participant's golfers for the given season", () => {
    const picks = [
      pick("p1", "t1", "g1"),
      pick("p2", "t1", "g2"),
      pick("p1", "t2", "g3"),
      pick("p1", "t9", "g4", { seasonId: "s2025" }),
    ];
    expect(usedGolferIds("p1", SEASON_ID, picks)).toEqual(new Set(["g1", "g3"]));
  });
});
