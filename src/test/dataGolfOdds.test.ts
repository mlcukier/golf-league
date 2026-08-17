import { describe, expect, it, vi } from "vitest";
import {
  createOddsCache,
  fetchWinOdds,
  oddsForTournament,
  parseAmericanOdds,
  type WinOddsResult,
} from "../providers/dataGolfOdds.js";

describe("parseAmericanOdds", () => {
  it("parses signed strings", () => {
    expect(parseAmericanOdds("+644")).toBe(644);
    expect(parseAmericanOdds("-120")).toBe(-120);
  });

  it("parses plain numbers", () => {
    expect(parseAmericanOdds(644)).toBe(644);
  });

  it("returns null for non-numeric values", () => {
    expect(parseAmericanOdds("n/a")).toBeNull();
    expect(parseAmericanOdds(undefined)).toBeNull();
  });
});

function fakeFetch(body: unknown, ok = true): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    statusText: ok ? "OK" : "Server Error",
    json: async () => body,
  }) as unknown as typeof fetch;
}

describe("fetchWinOdds", () => {
  it("maps baseline rows into a name -> odds map", async () => {
    const fetchImpl = fakeFetch({
      event_name: "BMW Championship",
      baseline: [
        { player_name: "Scheffler, Scottie", win: "+644" },
        { player_name: "McIlroy, Rory", win: "+1496" },
        { player_name: "No Odds Guy", win: "n/a" },
      ],
    });

    const result = await fetchWinOdds("key", "pga", fetchImpl);
    expect(result.eventName).toBe("BMW Championship");
    expect(result.oddsByPlayerName.get("Scheffler, Scottie")).toBe(644);
    expect(result.oddsByPlayerName.get("McIlroy, Rory")).toBe(1496);
    expect(result.oddsByPlayerName.has("No Odds Guy")).toBe(false);
  });

  it("throws on a non-ok response", async () => {
    await expect(fetchWinOdds("key", "pga", fakeFetch({}, false))).rejects.toThrow(/500/);
  });
});

describe("oddsForTournament", () => {
  const result: WinOddsResult = {
    eventName: "BMW Championship",
    oddsByPlayerName: new Map([["Scheffler, Scottie", 644]]),
  };

  it("returns odds when the event name matches", () => {
    expect(oddsForTournament(result, "BMW Championship")).toBe(result.oddsByPlayerName);
  });

  it("matches case-insensitively", () => {
    expect(oddsForTournament(result, "bmw championship")).toBe(result.oddsByPlayerName);
  });

  it("returns null when the event doesn't match — never hands back mismatched odds", () => {
    expect(oddsForTournament(result, "FedEx St. Jude Championship")).toBeNull();
  });

  it("returns null when there's no result at all", () => {
    expect(oddsForTournament(null, "BMW Championship")).toBeNull();
  });
});

describe("createOddsCache", () => {
  it("fetches once and serves the cache within the TTL", async () => {
    let now = 0;
    const fetchImpl = fakeFetch({ event_name: "BMW Championship", baseline: [] });
    const cache = createOddsCache("key", { fetchImpl, now: () => now, ttlMs: 1000 });

    await cache.get();
    now = 500;
    await cache.get();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("refetches once the TTL expires", async () => {
    let now = 0;
    const fetchImpl = fakeFetch({ event_name: "BMW Championship", baseline: [] });
    const cache = createOddsCache("key", { fetchImpl, now: () => now, ttlMs: 1000 });

    await cache.get();
    now = 1500;
    await cache.get();

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("falls back to the last good result on a fetch error instead of failing", async () => {
    let now = 0;
    let fail = false;
    const fetchImpl = vi.fn().mockImplementation(async () => {
      if (fail) throw new Error("network down");
      return { ok: true, status: 200, json: async () => ({ event_name: "BMW Championship", baseline: [] }) };
    }) as unknown as typeof fetch;
    const cache = createOddsCache("key", { fetchImpl, now: () => now, ttlMs: 1000 });

    const first = await cache.get();
    now = 1500;
    fail = true;
    const second = await cache.get();

    expect(second).toBe(first);
  });

  it("returns null (not a throw) when the very first fetch fails", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;
    const cache = createOddsCache("key", { fetchImpl });
    await expect(cache.get()).resolves.toBeNull();
  });
});
