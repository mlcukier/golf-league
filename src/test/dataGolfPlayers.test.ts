import { describe, expect, it, vi } from "vitest";
import { createPlayerListCache, fetchPgaTourPlayers } from "../providers/dataGolfPlayers.js";

function fakeFetch(body: unknown, ok = true): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    statusText: ok ? "OK" : "Server Error",
    json: async () => body,
  }) as unknown as typeof fetch;
}

describe("fetchPgaTourPlayers", () => {
  it("filters to primary_tour PGA and sorts alphabetically", async () => {
    const fetchImpl = fakeFetch({
      rankings: [
        { player_name: "McIlroy, Rory", primary_tour: "PGA" },
        { player_name: "Someone, European", primary_tour: "EURO" },
        { player_name: "Aberg, Ludvig", primary_tour: "PGA" },
      ],
    });

    const players = await fetchPgaTourPlayers("key", fetchImpl);
    expect(players.map((p) => p.name)).toEqual(["Aberg, Ludvig", "McIlroy, Rory"]);
  });

  it("throws on a non-ok response", async () => {
    await expect(fetchPgaTourPlayers("key", fakeFetch({}, false))).rejects.toThrow(/500/);
  });
});

describe("createPlayerListCache", () => {
  it("caches within the TTL and refetches after it expires", async () => {
    let now = 0;
    const fetchImpl = fakeFetch({ rankings: [] });
    const cache = createPlayerListCache("key", { fetchImpl, now: () => now, ttlMs: 1000 });

    await cache.get();
    now = 500;
    await cache.get();
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    now = 1500;
    await cache.get();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("falls back to the last good list on a fetch error", async () => {
    let fail = false;
    const fetchImpl = vi.fn().mockImplementation(async () => {
      if (fail) throw new Error("network down");
      return { ok: true, status: 200, json: async () => ({ rankings: [{ player_name: "A, B", primary_tour: "PGA" }] }) };
    }) as unknown as typeof fetch;
    const cache = createPlayerListCache("key", { fetchImpl, ttlMs: 0 });

    const first = await cache.get();
    fail = true;
    const second = await cache.get();
    expect(second).toEqual(first);
  });
});
