import { describe, expect, it, vi } from "vitest";
import { fetchLiveInPlay, isRoundComplete, liveDataForTournament, type LiveInPlayRow } from "../providers/dataGolfLive.js";

function fakeFetch(body: unknown, ok = true): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    statusText: ok ? "OK" : "Server Error",
    json: async () => body,
  }) as unknown as typeof fetch;
}

function row(overrides: Partial<LiveInPlayRow> = {}): LiveInPlayRow {
  return {
    playerName: "Scheffler, Scottie",
    round: 4,
    thru: 18,
    endHole: 18,
    currentPos: "1",
    currentScore: -17,
    ...overrides,
  };
}

describe("fetchLiveInPlay", () => {
  it("maps rows and the info block", async () => {
    const fetchImpl = fakeFetch({
      info: { event_name: "FedEx St. Jude Championship", current_round: 4, last_update: "2026-08-16 4:50 PM" },
      data: [
        {
          player_name: "Scheffler, Scottie",
          round: 4,
          thru: 18,
          end_hole: 18,
          current_pos: "1",
          current_score: -17,
        },
      ],
    });
    const result = await fetchLiveInPlay("key", "pga", fetchImpl);
    expect(result.eventName).toBe("FedEx St. Jude Championship");
    expect(result.currentRound).toBe(4);
    expect(result.lastUpdate).toBe("2026-08-16 4:50 PM");
    expect(result.rows).toEqual([
      { playerName: "Scheffler, Scottie", round: 4, thru: 18, endHole: 18, currentPos: "1", currentScore: -17 },
    ]);
  });

  it("throws on a non-ok response", async () => {
    await expect(fetchLiveInPlay("key", "pga", fakeFetch({}, false))).rejects.toThrow(/preds\/in-play failed/);
  });

  it("tolerates a missing info block and drops rows with no player name", async () => {
    const fetchImpl = fakeFetch({ data: [{ round: 1 }] });
    const result = await fetchLiveInPlay("key", "pga", fetchImpl);
    expect(result.eventName).toBe("");
    expect(result.currentRound).toBe(0);
    expect(result.rows).toEqual([]);
  });
});

describe("liveDataForTournament", () => {
  it("returns the result when the event name matches, case/whitespace-insensitively", () => {
    const result = { eventName: " The Open  ", currentRound: 1, lastUpdate: null, rows: [] };
    expect(liveDataForTournament(result, "the open")).toBe(result);
  });

  it("returns null on a name mismatch or a null result", () => {
    const result = { eventName: "The Open", currentRound: 1, lastUpdate: null, rows: [] };
    expect(liveDataForTournament(result, "The Masters")).toBeNull();
    expect(liveDataForTournament(null, "The Open")).toBeNull();
  });
});

describe("isRoundComplete", () => {
  it("is false on an empty feed", () => {
    expect(isRoundComplete([], 1)).toBe(false);
  });

  it("is false while anyone in that round is still out on the course", () => {
    const rows = [row({ round: 1, thru: 18 }), row({ playerName: "B", round: 1, thru: 12 })];
    expect(isRoundComplete(rows, 1)).toBe(false);
  });

  it("is true once everyone in that round has finished every hole", () => {
    const rows = [row({ round: 1, thru: 18 }), row({ playerName: "B", round: 1, thru: 18 })];
    expect(isRoundComplete(rows, 1)).toBe(true);
  });

  it("is false when anyone is still stuck on an earlier round (a suspended-play straggler)", () => {
    const rows = [row({ round: 2, thru: 18 }), row({ playerName: "B", round: 1, thru: 18 })];
    expect(isRoundComplete(rows, 2)).toBe(false);
  });

  it("is true when the whole feed has already moved past that round (self-healing catch-up)", () => {
    const rows = [row({ round: 4, thru: 18 }), row({ playerName: "B", round: 4, thru: 18 })];
    expect(isRoundComplete(rows, 2)).toBe(true);
  });
});
