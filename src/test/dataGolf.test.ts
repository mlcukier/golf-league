import { describe, expect, it, vi } from "vitest";
import { fetchDataGolfEventResults, mapEventStatsRow, parseFinishPosition } from "../providers/dataGolfProvider.js";

function fakeFetch(body: unknown, ok = true): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    statusText: ok ? "OK" : "Server Error",
    json: async () => body,
  }) as unknown as typeof fetch;
}

describe("parseFinishPosition", () => {
  it("reads plain and tied finishes", () => {
    expect(parseFinishPosition("1")).toBe(1);
    expect(parseFinishPosition("T9")).toBe(9);
    expect(parseFinishPosition(" T22 ")).toBe(22);
  });

  it("treats CUT / WD / MDF / missing as no finishing position", () => {
    for (const text of ["CUT", "WD", "MDF", "DQ", null]) {
      expect(parseFinishPosition(text)).toBeNull();
    }
  });
});

describe("mapEventStatsRow", () => {
  it("maps a winner row, deriving win/top-5/top-10 from the finish", () => {
    const result = mapEventStatsRow("t1", {
      dg_id: 18417,
      player_name: "Scheffler, Scottie",
      fin_text: "1",
      earnings: 3600000,
    });
    expect(result).toEqual({
      tournamentId: "t1",
      golferId: "dg-18417",
      earnings: 3600000,
      finishPosition: 1,
      madeCut: true,
      isWin: true,
      isTop5: true,
      isTop10: true,
    });
  });

  it("maps a missed cut to zero earnings and no finish", () => {
    const result = mapEventStatsRow("t1", {
      dg_id: 1,
      player_name: "Someone",
      fin_text: "CUT",
    });
    expect(result.madeCut).toBe(false);
    expect(result.finishPosition).toBeNull();
    expect(result.earnings).toBe(0);
  });

  it("accepts alternative earnings key names", () => {
    expect(mapEventStatsRow("t1", { dg_id: 2, fin_text: "T3", money: 450000 }).earnings).toBe(450000);
    expect(mapEventStatsRow("t1", { dg_id: 3, fin_text: "T3", prize_money: 450000 }).earnings).toBe(450000);
  });

  it("parses formatted currency strings", () => {
    expect(mapEventStatsRow("t1", { dg_id: 4, fin_text: "2", earnings: "$1,350,000" }).earnings).toBe(1350000);
  });

  it("classifies a T10 as top-10 but not top-5", () => {
    const result = mapEventStatsRow("t1", { dg_id: 5, fin_text: "T10", earnings: 200000 });
    expect(result.isTop10).toBe(true);
    expect(result.isTop5).toBe(false);
  });
});

describe("fetchDataGolfEventResults", () => {
  it("maps event_stats rows to golferName/earnings/finishPosition", async () => {
    const fetchImpl = fakeFetch({
      event_id: "6",
      event_stats: [
        { dg_id: 1, player_name: "Gotterup, Chris", fin_text: "1", earnings: 1638000 },
        { dg_id: 2, player_name: "Gerard, Ryan", fin_text: "CUT", earnings: 0 },
      ],
    });

    const rows = await fetchDataGolfEventResults("key", "pga", "6", 2026, fetchImpl);
    expect(rows).toEqual([
      { golferName: "Gotterup, Chris", earnings: 1638000, finishPosition: 1 },
      { golferName: "Gerard, Ryan", earnings: 0, finishPosition: null },
    ]);
  });

  it("returns an empty array when the event hasn't been posted yet", async () => {
    const rows = await fetchDataGolfEventResults("key", "pga", "999", 2026, fakeFetch({ event_stats: [] }));
    expect(rows).toEqual([]);
  });

  it("throws on a non-ok response", async () => {
    await expect(
      fetchDataGolfEventResults("key", "pga", "6", 2026, fakeFetch({}, false))
    ).rejects.toThrow(/500/);
  });

  it("skips rows with no player name", () => {
    return fetchDataGolfEventResults(
      "key",
      "pga",
      "6",
      2026,
      fakeFetch({ event_stats: [{ dg_id: 1, fin_text: "1", earnings: 100 }] })
    ).then((rows) => expect(rows).toEqual([]));
  });
});
