import { describe, expect, it } from "vitest";
import {
  findDueReminders,
  findDuePicksDigests,
  findTournamentsNeedingHearnResolution,
  liveGrellerCandidateIds,
} from "../core/notifications.js";
import { emptyLeagueData, type LeagueData } from "../store/store.js";
import { pick, tournament } from "./fixtures.js";
import type { League, Participant, Season } from "../types.js";

const LEAGUE_ID = "lg1";
const SEASON_ID = "s2026";

function baseData(overrides: Partial<LeagueData> = {}): LeagueData {
  const league: League = { id: LEAGUE_ID, name: "Real League", isTest: false, createdAt: "2026-01-01T00:00:00Z" };
  const season: Season = {
    id: SEASON_ID,
    leagueId: LEAGUE_ID,
    year: 2026,
    status: "ACTIVE",
    startDate: "2026-01-01",
    endDate: null,
    grellerWeeklyContribution: 10,
    missedCutFine: 50,
    toccStake: 100,
    toccStakeIfWinner: 200,
    buyIn: 0,
    overallPayouts: [],
    quarterPayouts: [],
  };
  const p1: Participant = { id: "p1", name: "A", email: "a@example.com" };
  const p2: Participant = { id: "p2", name: "B", email: "b@example.com" };
  return {
    ...emptyLeagueData(),
    leagues: [league],
    seasons: [season],
    participants: [p1, p2],
    seasonEntries: [
      { seasonId: SEASON_ID, participantId: "p1", isTOCCMember: false },
      { seasonId: SEASON_ID, participantId: "p2", isTOCCMember: false },
    ],
    ...overrides,
  };
}

describe("findDueReminders", () => {
  it("nudges a roster member with no pick inside the 24h window before deadline", () => {
    const now = new Date("2026-01-08T00:00:00Z"); // t1 starts 2026-01-08T08:00Z — 8h out
    const data = baseData({ tournaments: [tournament("t1", 1)], picks: [pick("p1", "t1", "g1")] });
    const due = findDueReminders(data, now);
    expect(due).toHaveLength(1);
    expect(due[0]!.participant.id).toBe("p2");
  });

  it("does nothing more than 24h before the deadline", () => {
    const now = new Date("2026-01-06T00:00:00Z"); // >24h before t1's deadline
    const data = baseData({ tournaments: [tournament("t1", 1)] });
    expect(findDueReminders(data, now)).toHaveLength(0);
  });

  it("does nothing once the deadline has passed", () => {
    const now = new Date("2026-01-09T00:00:00Z"); // after t1's deadline
    const data = baseData({ tournaments: [tournament("t1", 1)] });
    expect(findDueReminders(data, now)).toHaveLength(0);
  });

  it("skips a participant already nudged for this tournament", () => {
    const now = new Date("2026-01-08T00:00:00Z");
    const data = baseData({
      tournaments: [tournament("t1", 1)],
      picks: [pick("p1", "t1", "g1")],
      notifications: [{ type: "PICK_REMINDER", tournamentId: "t1", participantId: "p2", sentAt: now.toISOString() }],
    });
    expect(findDueReminders(data, now)).toHaveLength(0);
  });

  it("fires for a test league too, so it's usable as a live rehearsal", () => {
    const now = new Date("2026-01-08T00:00:00Z");
    const data = baseData({
      leagues: [{ id: LEAGUE_ID, name: "Test", isTest: true, createdAt: "2026-01-01T00:00:00Z" }],
      tournaments: [tournament("t1", 1)],
    });
    expect(findDueReminders(data, now)).toHaveLength(2);
  });
});

describe("findTournamentsNeedingHearnResolution", () => {
  it("fires once the deadline has passed with a still-unpicked roster member", () => {
    const now = new Date("2026-01-08T12:00:00Z");
    const data = baseData({ tournaments: [tournament("t1", 1)], picks: [pick("p1", "t1", "g1")] });
    expect(findTournamentsNeedingHearnResolution(data, now)).toEqual([
      { season: data.seasons[0], tournament: data.tournaments[0] },
    ]);
  });

  it("does not fire before the deadline, even with nobody picked", () => {
    const now = new Date("2026-01-08T00:00:00Z");
    const data = baseData({ tournaments: [tournament("t1", 1)] });
    expect(findTournamentsNeedingHearnResolution(data, now)).toHaveLength(0);
  });

  it("does not fire once everyone already has a pick", () => {
    const now = new Date("2026-01-08T12:00:00Z");
    const data = baseData({
      tournaments: [tournament("t1", 1)],
      picks: [pick("p1", "t1", "g1"), pick("p2", "t1", "g2")],
    });
    expect(findTournamentsNeedingHearnResolution(data, now)).toHaveLength(0);
  });

  it("has no lookback bound, unlike the digest — still fires long after the deadline", () => {
    const now = new Date("2026-01-20T00:00:00Z"); // well past the 48h digest lookback
    const data = baseData({ tournaments: [tournament("t1", 1)] });
    expect(findTournamentsNeedingHearnResolution(data, now)).toHaveLength(1);
  });
});

describe("findDuePicksDigests", () => {
  it("fires once the deadline has passed and no digest was sent yet", () => {
    const now = new Date("2026-01-08T12:00:00Z"); // 4h after t1's 08:00Z deadline
    const data = baseData({ tournaments: [tournament("t1", 1)] });
    const due = findDuePicksDigests(data, now);
    expect(due).toEqual([{ season: data.seasons[0], tournament: data.tournaments[0] }]);
  });

  it("does not fire before the deadline", () => {
    const now = new Date("2026-01-08T00:00:00Z");
    const data = baseData({ tournaments: [tournament("t1", 1)] });
    expect(findDuePicksDigests(data, now)).toHaveLength(0);
  });

  it("does not re-fire once already sent", () => {
    const now = new Date("2026-01-08T12:00:00Z");
    const data = baseData({
      tournaments: [tournament("t1", 1)],
      notifications: [{ type: "PICKS_DIGEST", tournamentId: "t1", sentAt: now.toISOString() }],
    });
    expect(findDuePicksDigests(data, now)).toHaveLength(0);
  });

  it("does not fire for a deadline more than 48h in the past (stale/backfill guard)", () => {
    const now = new Date("2026-01-15T00:00:00Z"); // ~7 days after t1's deadline
    const data = baseData({ tournaments: [tournament("t1", 1)] });
    expect(findDuePicksDigests(data, now)).toHaveLength(0);
  });
});

describe("liveGrellerCandidateIds", () => {
  it("flags a pick nobody else made", () => {
    const picks = [pick("p1", "t1", "g1"), pick("p2", "t1", "g2")];
    expect(liveGrellerCandidateIds(picks)).toEqual(new Set(["p1", "p2"]));
  });

  it("excludes a golfer picked by more than one participant", () => {
    const picks = [pick("p1", "t1", "g1"), pick("p2", "t1", "g1"), pick("p3", "t1", "g3")];
    expect(liveGrellerCandidateIds(picks)).toEqual(new Set(["p3"]));
  });
});
