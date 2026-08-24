import { describe, expect, it, vi } from "vitest";
import { runFieldUpdateSweep } from "../jobs/fieldUpdate.js";
import { MemoryLeagueStore } from "../store/jsonStore.js";
import { emptyLeagueData, type LeagueData } from "../store/store.js";
import { pick, tournament, SEASON_ID } from "./fixtures.js";
import type { Golfer, Participant, Season } from "../types.js";

function fakeFetch(body: unknown): typeof fetch {
  return vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body }) as unknown as typeof fetch;
}

function golfer(id: string, name: string): Golfer {
  return { id, name };
}

function participant(id: string, overrides: Partial<Participant> = {}): Participant {
  return { id, name: id, email: `${id}@example.com`, ...overrides };
}

function season(overrides: Partial<Season> = {}): Season {
  return {
    id: SEASON_ID,
    leagueId: "lg1",
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
    ...overrides,
  };
}

function baseData(overrides: Partial<LeagueData> = {}): LeagueData {
  return {
    ...emptyLeagueData(),
    leagues: [{ id: "lg1", name: "Main", isTest: false, createdAt: "2026-01-01T00:00:00Z" }],
    seasons: [season()],
    golfers: [golfer("g1", "Scottie Scheffler"), golfer("g2", "Rory McIlroy")],
    participants: [participant("p1"), participant("admin1", { isAdmin: true })],
    seasonEntries: [
      { seasonId: SEASON_ID, participantId: "p1", isTOCCMember: false },
      { seasonId: SEASON_ID, participantId: "admin1", isTOCCMember: false },
    ],
    ...overrides,
  };
}

const fieldResponse = (eventId: number, names: string[]) => ({
  event_id: eventId,
  event_name: "BMW Championship",
  field: names.map((n) => ({ player_name: n })),
});

describe("runFieldUpdateSweep", () => {
  it("sets the field on first check without alerting anyone (no baseline to diff against)", async () => {
    const t = tournament("t1", 1, { externalEventId: "34" });
    const store = new MemoryLeagueStore(baseData({ tournaments: [t] }));
    const sendMail = vi.fn().mockResolvedValue(undefined);
    const fetchImpl = fakeFetch(fieldResponse(34, ["Scheffler, Scottie", "McIlroy, Rory"]));

    await runFieldUpdateSweep(store, sendMail, "http://app", "key", "pga", new Date("2026-01-01T00:00:00Z"), fetchImpl);

    const data = await store.read();
    expect(data.fields["t1"]).toHaveLength(2);
    expect(data.tournaments[0]!.fieldLastCheckedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("alerts the affected participant and admins when their pick's golfer is dropped from the field", async () => {
    const t = tournament("t1", 1, { externalEventId: "34", startTime: "2026-01-10T10:00:00Z" });
    const store = new MemoryLeagueStore(
      baseData({
        tournaments: [t],
        fields: { t1: ["g1", "g2"] },
        picks: [pick("p1", "t1", "g2")],
      })
    );
    const sendMail = vi.fn().mockResolvedValue(undefined);
    // g2 (McIlroy) withdrew — only Scheffler remains.
    const fetchImpl = fakeFetch(fieldResponse(34, ["Scheffler, Scottie"]));

    await runFieldUpdateSweep(store, sendMail, "http://app", "key", "pga", new Date("2026-01-05T00:00:00Z"), fetchImpl);

    expect(sendMail).toHaveBeenCalledTimes(2);
    const toAddresses = sendMail.mock.calls.map((c) => c[0].to);
    expect(toAddresses).toContain("p1@example.com");
    expect(toAddresses).toContain("admin1@example.com");

    const data = await store.read();
    expect(data.fields["t1"]).toEqual(["g1"]);
    expect(data.notifications).toEqual([
      expect.objectContaining({ type: "FIELD_WITHDRAWAL", tournamentId: "t1", participantId: "p1", golferId: "g2" }),
    ]);
  });

  it("never re-alerts for the same (tournament, participant, golfer) on a later check", async () => {
    const t = tournament("t1", 1, { externalEventId: "34", startTime: "2026-01-10T10:00:00Z" });
    const store = new MemoryLeagueStore(
      baseData({
        tournaments: [t],
        fields: { t1: ["g1", "g2"] },
        picks: [pick("p1", "t1", "g2")],
        notifications: [
          { type: "FIELD_WITHDRAWAL", tournamentId: "t1", participantId: "p1", golferId: "g2", sentAt: "2026-01-04T00:00:00Z" },
        ],
      })
    );
    const sendMail = vi.fn().mockResolvedValue(undefined);
    const fetchImpl = fakeFetch(fieldResponse(34, ["Scheffler, Scottie"]));

    await runFieldUpdateSweep(store, sendMail, "http://app", "key", "pga", new Date("2026-01-05T00:00:00Z"), fetchImpl);

    expect(sendMail).not.toHaveBeenCalled();
  });

  it("skips a tournament whose currently-loaded DataGolf event doesn't match, without touching its stored field", async () => {
    const t = tournament("t1", 1, { externalEventId: "99" });
    const store = new MemoryLeagueStore(baseData({ tournaments: [t], fields: { t1: ["g1"] } }));
    const sendMail = vi.fn().mockResolvedValue(undefined);
    const fetchImpl = fakeFetch(fieldResponse(34, ["Scheffler, Scottie"]));

    await runFieldUpdateSweep(store, sendMail, "http://app", "key", "pga", new Date("2026-01-01T00:00:00Z"), fetchImpl);

    const data = await store.read();
    expect(data.fields["t1"]).toEqual(["g1"]);
    expect(data.tournaments[0]!.fieldLastCheckedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("skips any tournament checked within the last 12 hours, and never even calls fetch when nothing needs checking", async () => {
    const t = tournament("t1", 1, { externalEventId: "34", fieldLastCheckedAt: "2026-01-05T06:00:00Z" });
    const store = new MemoryLeagueStore(baseData({ tournaments: [t], fields: { t1: ["g1", "g2"] } }));
    const sendMail = vi.fn().mockResolvedValue(undefined);
    const fetchImpl = fakeFetch(fieldResponse(34, ["Scheffler, Scottie"]));

    await runFieldUpdateSweep(store, sendMail, "http://app", "key", "pga", new Date("2026-01-05T12:00:00Z"), fetchImpl);

    expect(fetchImpl).not.toHaveBeenCalled();
    const data = await store.read();
    expect(data.fields["t1"]).toEqual(["g1", "g2"]);
  });

  it("does not treat an empty field response as a mass withdrawal", async () => {
    const t = tournament("t1", 1, { externalEventId: "34" });
    const store = new MemoryLeagueStore(
      baseData({ tournaments: [t], fields: { t1: ["g1", "g2"] }, picks: [pick("p1", "t1", "g2")] })
    );
    const sendMail = vi.fn().mockResolvedValue(undefined);
    const fetchImpl = fakeFetch(fieldResponse(34, []));

    await runFieldUpdateSweep(store, sendMail, "http://app", "key", "pga", new Date("2026-01-01T00:00:00Z"), fetchImpl);

    const data = await store.read();
    expect(data.fields["t1"]).toEqual(["g1", "g2"]);
    expect(sendMail).not.toHaveBeenCalled();
  });
});
