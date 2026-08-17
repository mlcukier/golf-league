import { describe, expect, it, vi } from "vitest";
import { createGolferFormCache, fetchGolferFormData } from "../providers/dataGolfForm.js";

const EVENT_LIST = [
  { event_id: 28, event_name: "BMW Championship", calendar_year: 2026, date: "2026-08-20", tour: "pga" }, // not completed (>= now)
  { event_id: 27, event_name: "FedEx St. Jude Championship", calendar_year: 2026, date: "2026-08-13", tour: "pga" },
  { event_id: 13, event_name: "Wyndham Championship", calendar_year: 2026, date: "2026-08-06", tour: "pga" },
  { event_id: 28, event_name: "BMW Championship", calendar_year: 2025, date: "2025-08-21", tour: "pga" }, // last year's BMW — course history hit
];

function fakeFetchImpl(): typeof fetch {
  return vi.fn().mockImplementation(async (url: string) => {
    const u = new URL(url);
    if (u.pathname === "/historical-event-data/event-list") {
      return { ok: true, status: 200, json: async () => EVENT_LIST };
    }
    if (u.pathname === "/historical-event-data/events") {
      const eventId = Number(u.searchParams.get("event_id"));
      const year = Number(u.searchParams.get("year"));
      if (eventId === 27 && year === 2026) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            event_stats: [
              { player_name: "Scheffler, Scottie", fin_text: "1" },
              { player_name: "Kim, Si Woo", fin_text: "T3" },
            ],
          }),
        };
      }
      if (eventId === 13 && year === 2026) {
        return { ok: true, status: 200, json: async () => ({ event_stats: [{ player_name: "Scheffler, Scottie", fin_text: "CUT" }] }) };
      }
      if (eventId === 28 && year === 2025) {
        return { ok: true, status: 200, json: async () => ({ event_stats: [{ player_name: "Scheffler, Scottie", fin_text: "2" }] }) };
      }
      return { ok: true, status: 200, json: async () => ({ event_stats: [] }) };
    }
    throw new Error("unexpected URL: " + url);
  }) as unknown as typeof fetch;
}

const NOW = new Date("2026-08-17T00:00:00Z"); // BMW (2026-08-20) hasn't happened yet

describe("fetchGolferFormData", () => {
  it("excludes the not-yet-played current event (BMW 2026) from recent starts, but keeps every other completed one in this small fixture", async () => {
    const data = await fetchGolferFormData("key", "pga", 28, NOW, fakeFetchImpl());
    const scheffler = data.recentStarts.get("Scheffler, Scottie")!;
    expect(scheffler.map((s) => s.eventName)).toEqual([
      "FedEx St. Jude Championship",
      "Wyndham Championship",
      "BMW Championship", // last year's BMW — legitimately "recent" too, just also happens to be the course-history hit
    ]);
  });

  it("orders recent starts newest first and parses finish position", async () => {
    const data = await fetchGolferFormData("key", "pga", 28, NOW, fakeFetchImpl());
    const scheffler = data.recentStarts.get("Scheffler, Scottie")!;
    expect(scheffler[0]).toEqual({ date: "2026-08-13", eventName: "FedEx St. Jude Championship", finishPosition: 1 });
    expect(scheffler[1]).toEqual({ date: "2026-08-06", eventName: "Wyndham Championship", finishPosition: null }); // CUT
  });

  it("finds course history by matching event_id across years, independent of the recent-starts window", async () => {
    const data = await fetchGolferFormData("key", "pga", 28, NOW, fakeFetchImpl());
    const history = data.courseHistory.get("Scheffler, Scottie")!;
    expect(history).toEqual([{ date: "2025-08-21", eventName: "BMW Championship", finishPosition: 2 }]);
  });

  it("has no course history for a player who's never played this event id before", async () => {
    const data = await fetchGolferFormData("key", "pga", 28, NOW, fakeFetchImpl());
    expect(data.courseHistory.get("Kim, Si Woo")).toBeUndefined();
  });
});

describe("createGolferFormCache", () => {
  it("caches within the TTL for the same event id", async () => {
    let t = 0;
    const fetchImpl = fakeFetchImpl();
    const cache = createGolferFormCache("key", { fetchImpl, now: () => t, ttlMs: 1000 });
    await cache.get(28);
    t = 500;
    await cache.get(28);
    // event-list + 3 distinct events fetched once each = 4 calls total, not doubled.
    expect((fetchImpl as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(4);
  });

  it("refetches when a different event id is requested", async () => {
    let t = 0;
    const fetchImpl = fakeFetchImpl();
    const cache = createGolferFormCache("key", { fetchImpl, now: () => t, ttlMs: 100000 });
    await cache.get(28);
    const firstCallCount = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls.length;
    await cache.get(13);
    expect((fetchImpl as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(firstCallCount);
  });

  it("falls back to the last good result for the same event id on a fetch error", async () => {
    let fail = false;
    const fetchImpl = vi.fn().mockImplementation(async (url: string) => {
      if (fail) throw new Error("network down");
      return fakeFetchImpl()(url as unknown as string);
    }) as unknown as typeof fetch;
    const cache = createGolferFormCache("key", { fetchImpl, ttlMs: 0 });
    const first = await cache.get(28);
    fail = true;
    const second = await cache.get(28);
    expect(second).toEqual(first);
  });
});
