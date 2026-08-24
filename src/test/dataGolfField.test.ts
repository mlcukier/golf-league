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
