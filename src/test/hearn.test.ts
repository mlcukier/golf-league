import { describe, expect, it } from "vitest";
import {
  applyHearnFallbacks,
  findDeadHearnEntries,
  hearnListLockStatus,
  resolveHearnPick,
} from "../core/hearn.js";
import { usedGolferIds } from "../core/oneAndDone.js";
import { hearn, pick, SEASON_ID, tournament } from "./fixtures.js";

const FIELD = new Set(["g1", "g2", "g3", "g4"]);

describe("resolveHearnPick", () => {
  it("takes the highest-ranked golfer when nothing is used yet", () => {
    const resolution = resolveHearnPick({
      participantId: "p1",
      seasonId: SEASON_ID,
      tournamentId: "t5",
      hearnList: [hearn("p1", "g2", 2), hearn("p1", "g1", 1)],
      existingPicks: [],
      tournamentField: FIELD,
    });
    expect(resolution.golferId).toBe("g1");
  });

  it("skips a golfer the participant already used and takes the next one", () => {
    const resolution = resolveHearnPick({
      participantId: "p1",
      seasonId: SEASON_ID,
      tournamentId: "t5",
      hearnList: [hearn("p1", "g1", 1), hearn("p1", "g2", 2)],
      existingPicks: [pick("p1", "t1", "g1")],
      tournamentField: FIELD,
    });
    expect(resolution.golferId).toBe("g2");
    expect(resolution.evaluated[0]).toEqual({ golferId: "g1", rank: 1, skipped: "ALREADY_USED" });
  });

  it("skips a golfer who isn't in this week's field", () => {
    const resolution = resolveHearnPick({
      participantId: "p1",
      seasonId: SEASON_ID,
      tournamentId: "t5",
      hearnList: [hearn("p1", "g9", 1), hearn("p1", "g2", 2)],
      existingPicks: [],
      tournamentField: FIELD,
    });
    expect(resolution.golferId).toBe("g2");
    expect(resolution.evaluated[0]).toEqual({ golferId: "g9", rank: 1, skipped: "NOT_IN_FIELD" });
  });

  it("returns null rather than reusing a golfer when the whole list is burned", () => {
    const resolution = resolveHearnPick({
      participantId: "p1",
      seasonId: SEASON_ID,
      tournamentId: "t5",
      hearnList: [hearn("p1", "g1", 1), hearn("p1", "g2", 2)],
      existingPicks: [pick("p1", "t1", "g1"), pick("p1", "t2", "g2")],
      tournamentField: FIELD,
    });
    expect(resolution.golferId).toBeNull();
    expect(resolution.evaluated.every((e) => e.skipped === "ALREADY_USED")).toBe(true);
  });

  it("ignores another participant's Hearn entries", () => {
    const resolution = resolveHearnPick({
      participantId: "p1",
      seasonId: SEASON_ID,
      tournamentId: "t5",
      hearnList: [hearn("p2", "g1", 1)],
      existingPicks: [],
      tournamentField: FIELD,
    });
    expect(resolution.golferId).toBeNull();
  });

  it("does not treat another participant's usage as burning the golfer", () => {
    const resolution = resolveHearnPick({
      participantId: "p1",
      seasonId: SEASON_ID,
      tournamentId: "t5",
      hearnList: [hearn("p1", "g1", 1)],
      existingPicks: [pick("p2", "t1", "g1")],
      tournamentField: FIELD,
    });
    expect(resolution.golferId).toBe("g1");
  });

  it("ignores golfers burned in a previous season", () => {
    const resolution = resolveHearnPick({
      participantId: "p1",
      seasonId: SEASON_ID,
      tournamentId: "t5",
      hearnList: [hearn("p1", "g1", 1)],
      existingPicks: [pick("p1", "old", "g1", { seasonId: "s2025" })],
      tournamentField: FIELD,
    });
    expect(resolution.golferId).toBe("g1");
  });
});

describe("applyHearnFallbacks", () => {
  const roster = ["p1", "p2", "p3"];

  it("only fills in participants who have no pick for the week", () => {
    const out = applyHearnFallbacks({
      seasonId: SEASON_ID,
      tournamentId: "t5",
      participantIds: roster,
      hearnLists: [hearn("p1", "g1", 1), hearn("p2", "g2", 1), hearn("p3", "g3", 1)],
      existingPicks: [pick("p2", "t5", "g4")], // p2 already picked
      tournamentField: FIELD,
      assignedAt: "2026-02-05T13:00:00Z",
    });
    expect(out.picks.map((p) => p.participantId)).toEqual(["p1", "p3"]);
    expect(out.picks.every((p) => p.source === "hearn")).toBe(true);
  });

  it("reports participants left with no usable Hearn option", () => {
    const out = applyHearnFallbacks({
      seasonId: SEASON_ID,
      tournamentId: "t5",
      participantIds: ["p1"],
      hearnLists: [hearn("p1", "g1", 1)],
      existingPicks: [pick("p1", "t1", "g1")],
      tournamentField: FIELD,
      assignedAt: "2026-02-05T13:00:00Z",
    });
    expect(out.picks).toEqual([]);
    expect(out.unresolved).toEqual(["p1"]);
  });

  it("lets two participants fall back onto the same golfer", () => {
    const out = applyHearnFallbacks({
      seasonId: SEASON_ID,
      tournamentId: "t5",
      participantIds: ["p1", "p2"],
      hearnLists: [hearn("p1", "g1", 1), hearn("p2", "g1", 1)],
      existingPicks: [],
      tournamentField: FIELD,
      assignedAt: "2026-02-05T13:00:00Z",
    });
    expect(out.picks.map((p) => p.golferId)).toEqual(["g1", "g1"]);
  });

  it("never violates one-and-done across a full simulated season", () => {
    // p1 has a 4-deep Hearn list and forgets to pick for 6 straight weeks.
    const hearnList = [
      hearn("p1", "g1", 1),
      hearn("p1", "g2", 2),
      hearn("p1", "g3", 3),
      hearn("p1", "g4", 4),
    ];
    let picks = [] as ReturnType<typeof pick>[];

    for (let week = 1; week <= 6; week++) {
      const out = applyHearnFallbacks({
        seasonId: SEASON_ID,
        tournamentId: `t${week}`,
        participantIds: ["p1"],
        hearnLists: hearnList,
        existingPicks: picks,
        tournamentField: FIELD,
        assignedAt: `2026-0${week}-05T13:00:00Z`,
      });
      picks = [...picks, ...out.picks];
    }

    // Four usable golfers means four assigned weeks, then nothing — never a repeat.
    expect(picks.map((p) => p.golferId)).toEqual(["g1", "g2", "g3", "g4"]);
    expect(usedGolferIds("p1", SEASON_ID, picks).size).toBe(picks.length);
  });

  it("never re-attempts a participant already marked as attempted, even with no pick", () => {
    // p1's list was exhausted on a prior sweep tick (recorded as attempted).
    // A fresh golfer added to their list afterward must not retroactively
    // resolve them — that's the live-viewing loophole this guards against.
    const out = applyHearnFallbacks({
      seasonId: SEASON_ID,
      tournamentId: "t5",
      participantIds: ["p1"],
      hearnLists: [hearn("p1", "g1", 1)],
      existingPicks: [],
      tournamentField: FIELD,
      assignedAt: "2026-02-05T13:00:00Z",
      alreadyAttemptedParticipantIds: new Set(["p1"]),
    });
    expect(out.picks).toEqual([]);
    expect(out.resolutions).toEqual([]);
    expect(out.unresolved).toEqual([]);
  });
});

describe("hearnListLockStatus", () => {
  const t1 = tournament("t1", 1); // starts 2026-01-08T08:00:00Z
  const t2 = tournament("t2", 2); // starts 2026-01-15T08:00:00Z

  it("is unlocked before any tournament has started", () => {
    const status = hearnListLockStatus({
      seasonId: SEASON_ID,
      participantId: "p1",
      tournaments: [t1, t2],
      existingPicks: [],
      attemptedTournamentIds: new Set(),
      now: new Date("2026-01-01T00:00:00Z"),
    });
    expect(status.locked).toBe(false);
  });

  it("locks once a tournament starts with no pick and no resolution attempt yet", () => {
    const status = hearnListLockStatus({
      seasonId: SEASON_ID,
      participantId: "p1",
      tournaments: [t1, t2],
      existingPicks: [],
      attemptedTournamentIds: new Set(),
      now: new Date("2026-01-08T09:00:00Z"), // an hour after t1 started
    });
    expect(status.locked).toBe(true);
    expect(status.tournamentId).toBe("t1");
  });

  it("stays unlocked if the participant already has a pick for the started tournament", () => {
    const status = hearnListLockStatus({
      seasonId: SEASON_ID,
      participantId: "p1",
      tournaments: [t1],
      existingPicks: [pick("p1", "t1", "g1")],
      attemptedTournamentIds: new Set(),
      now: new Date("2026-01-08T09:00:00Z"),
    });
    expect(status.locked).toBe(false);
  });

  it("unlocks once resolution has been attempted, even with no pick to show for it", () => {
    const status = hearnListLockStatus({
      seasonId: SEASON_ID,
      participantId: "p1",
      tournaments: [t1],
      existingPicks: [], // exhausted Hearn list -> permanent zero, still no Pick record
      attemptedTournamentIds: new Set(["t1"]),
      now: new Date("2026-01-08T09:00:00Z"),
    });
    expect(status.locked).toBe(false);
  });

  it("locks on the checked participant's own pick, unaffected by a teammate's pick", () => {
    const status = hearnListLockStatus({
      seasonId: SEASON_ID,
      participantId: "p1",
      tournaments: [t1],
      existingPicks: [pick("p2", "t1", "g1")], // p1 still has no pick, but check is for p1
      attemptedTournamentIds: new Set(),
      now: new Date("2026-01-08T09:00:00Z"),
    });
    expect(status.locked).toBe(true);
  });
});

describe("findDeadHearnEntries", () => {
  it("flags list entries whose golfer the participant already burned", () => {
    const dead = findDeadHearnEntries(
      SEASON_ID,
      [hearn("p1", "g1", 1), hearn("p1", "g2", 2)],
      [pick("p1", "t1", "g1")]
    );
    expect(dead).toEqual([hearn("p1", "g1", 1)]);
  });
});
