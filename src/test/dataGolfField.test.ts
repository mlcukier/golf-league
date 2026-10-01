import { describe, expect, it, vi } from "vitest";
import { fetchFieldUpdate, fieldForTournament, type FieldUpdateResult } from "../providers/dataGolfField.js";

function fakeFetch(body: unknown, ok = true): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    statusText: ok ? "OK" : "Server Error",
    json: async () => body,
  }) as unknown as typeof fetch;
}

describe("fetchFieldUpdate", () => {
  it("maps field rows into player names, alongside the event id/name", async () => {
    const fetchImpl = fakeFetch({
      event_id: 34,
      event_name: "BMW Championship",
      field: [{ player_name: "Scheffler, Scottie" }, { player_name: "McIlroy, Rory" }, { no_name: true }],
    });

    const result = await fetchFieldUpdate("key", "pga", fetchImpl);
    expect(result.eventId).toBe("34");
    expect(result.eventName).toBe("BMW Championship");
    expect(result.golferNames).toEqual(["Scheffler, Scottie", "McIlroy, Rory"]);
    expect(result.firstTeeTime).toBeNull();
  });

  it("converts the earliest round-1 tee time from course-local to UTC via tz_offset", async () => {
    const tt = (round_num: number, teetime: string) => ({ round_num, teetime });
    const fetchImpl = fakeFetch({
      event_id: 554,
      event_name: "Bank of Utah Championship",
      tz_offset: -21600, // MDT
      field: [
        { player_name: "Bauchou, Zach", teetimes: [tt(1, "2026-10-01 09:03"), tt(2, "2026-10-02 06:50")] },
        { player_name: "Akina, Kihei", teetimes: [tt(1, "2026-10-01 07:35"), tt(2, "2026-10-02 13:58")] },
      ],
    });

    const result = await fetchFieldUpdate("key", "pga", fetchImpl);
    // 07:35 MDT, not round 2's earlier-looking 06:50 the next day.
    expect(result.firstTeeTime).toBe("2026-10-01T13:35:00.000Z");
  });

  it("leaves firstTeeTime null without a tz_offset rather than guessing the zone", async () => {
    const fetchImpl = fakeFetch({
      event_id: 554,
      field: [{ player_name: "Akina, Kihei", teetimes: [{ round_num: 1, teetime: "2026-10-01 07:35" }] }],
    });
    expect((await fetchFieldUpdate("key", "pga", fetchImpl)).firstTeeTime).toBeNull();
  });

  it("throws on a non-ok response", async () => {
    await expect(fetchFieldUpdate("key", "pga", fakeFetch({}, false))).rejects.toThrow(/500/);
  });
});

describe("fieldForTournament", () => {
  const result: FieldUpdateResult = {
    eventId: "34",
    eventName: "BMW Championship",
    golferNames: ["Scheffler, Scottie"],
    firstTeeTime: null,
  };

  it("returns the field when the event id matches", () => {
    expect(fieldForTournament(result, "34")).toBe(result.golferNames);
  });

  it("returns null when the event id doesn't match — never hands back the wrong week's field", () => {
    expect(fieldForTournament(result, "27")).toBeNull();
  });

  it("returns null when the tournament has no externalEventId at all", () => {
    expect(fieldForTournament(result, undefined)).toBeNull();
  });
});
