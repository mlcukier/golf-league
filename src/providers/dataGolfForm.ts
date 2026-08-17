import { parseFinishPosition } from "./dataGolfProvider.js";

const BASE_URL = "https://feeds.datagolf.com";

/** How many past completed events to crawl looking for each player's recent starts. */
export const RECENT_EVENTS_WINDOW = 20;
/** Cap on how many of a player's most recent starts get kept. */
export const MAX_RECENT_STARTS = 5;

export interface GolferStart {
  /** ISO date (event-list's `date`, the event's start date). */
  date: string;
  eventName: string;
  finishPosition: number | null;
}

export interface GolferFormData {
  /** DataGolf "Last, First" player_name -> up to their 5 most recent starts, newest first. */
  recentStarts: Map<string, GolferStart[]>;
  /** player_name -> their finish in past playings of the SAME event (matched by event_id), newest first. */
  courseHistory: Map<string, GolferStart[]>;
}

interface EventListEntry {
  event_id: number;
  event_name: string;
  calendar_year: number;
  date: string;
  tour: string;
}

async function getJson(apiKey: string, path: string, params: Record<string, string>, fetchImpl: typeof fetch): Promise<unknown> {
  const url = new URL(`${BASE_URL}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("file_format", "json");
  url.searchParams.set("key", apiKey);
  const response = await fetchImpl(url.toString());
  if (!response.ok) throw new Error(`DataGolf ${path} failed: ${response.status} ${response.statusText}`);
  return response.json();
}

async function fetchEventList(apiKey: string, tour: string, fetchImpl: typeof fetch): Promise<EventListEntry[]> {
  const raw = await getJson(apiKey, "historical-event-data/event-list", { tour }, fetchImpl);
  return Array.isArray(raw) ? (raw as EventListEntry[]) : [];
}

async function fetchEventStats(
  apiKey: string,
  tour: string,
  eventId: number,
  year: number,
  fetchImpl: typeof fetch
): Promise<Record<string, unknown>[]> {
  const raw = (await getJson(
    apiKey,
    "historical-event-data/events",
    { tour, event_id: String(eventId), year: String(year) },
    fetchImpl
  )) as { event_stats?: unknown[] };
  return Array.isArray(raw.event_stats) ? (raw.event_stats as Record<string, unknown>[]) : [];
}

/**
 * DataGolf has no endpoint for "a player's recent starts" or "a player's
 * history at this course" — both are built by hand here from event-level
 * data (historical-event-data/event-list + /events), confirmed live:
 * event_id is stable for a tournament across years (BMW Championship is
 * event_id 28 in both 2025 and 2026), so "course history" is every past
 * event-list entry sharing the current tournament's event_id. "Recent
 * starts" crawls the RECENT_EVENTS_WINDOW most recent completed events
 * (across the whole tour, not per-player — DataGolf has no per-player
 * filter) and, for each player found, keeps their newest MAX_RECENT_STARTS
 * appearances. This is O(events checked), not O(players x events) — one
 * events-stats call per distinct event covers every player in that field at
 * once, not one call per player.
 */
export async function fetchGolferFormData(
  apiKey: string,
  tour: string,
  currentEventId: number,
  now: Date = new Date(),
  fetchImpl: typeof fetch = fetch
): Promise<GolferFormData> {
  const eventList = await fetchEventList(apiKey, tour, fetchImpl);
  const completed = eventList
    .filter((e) => new Date(e.date).getTime() < now.getTime())
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const recentBatch = completed.slice(0, RECENT_EVENTS_WINDOW);
  const courseBatch = completed.filter((e) => e.event_id === currentEventId);

  const statsByKey = new Map<string, Record<string, unknown>[]>();
  const need = new Map<string, EventListEntry>();
  for (const e of [...recentBatch, ...courseBatch]) need.set(`${e.event_id}:${e.calendar_year}`, e);
  for (const [key, entry] of need) {
    try {
      statsByKey.set(key, await fetchEventStats(apiKey, tour, entry.event_id, entry.calendar_year, fetchImpl));
    } catch (err) {
      console.error(`DataGolf events fetch failed for ${entry.event_name} ${entry.calendar_year}:`, err);
      statsByKey.set(key, []); // one bad event shouldn't sink the whole crawl
    }
  }

  const toStart = (entry: EventListEntry, row: Record<string, unknown>): GolferStart => ({
    date: entry.date,
    eventName: entry.event_name,
    finishPosition: parseFinishPosition(typeof row.fin_text === "string" ? row.fin_text : null),
  });

  const recentStarts = new Map<string, GolferStart[]>();
  for (const entry of recentBatch) {
    const stats = statsByKey.get(`${entry.event_id}:${entry.calendar_year}`) ?? [];
    for (const row of stats) {
      const name = typeof row.player_name === "string" ? row.player_name : "";
      if (!name) continue;
      const list = recentStarts.get(name) ?? [];
      if (list.length >= MAX_RECENT_STARTS) continue;
      list.push(toStart(entry, row));
      recentStarts.set(name, list);
    }
  }

  const courseHistory = new Map<string, GolferStart[]>();
  for (const entry of courseBatch) {
    const stats = statsByKey.get(`${entry.event_id}:${entry.calendar_year}`) ?? [];
    for (const row of stats) {
      const name = typeof row.player_name === "string" ? row.player_name : "";
      if (!name) continue;
      const list = courseHistory.get(name) ?? [];
      list.push(toStart(entry, row));
      courseHistory.set(name, list);
    }
  }

  return { recentStarts, courseHistory };
}

export interface GolferFormCache {
  get(currentEventId: number): Promise<GolferFormData | null>;
}

export interface GolferFormCacheOptions {
  tour?: string;
  ttlMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/**
 * This is a ~20-request crawl, not a cheap call — cache it per tournament
 * (keyed by event id) with a long TTL, since recent-form/course-history data
 * only meaningfully changes once a week when the field turns over. Falls
 * back to the last good result for the SAME event id on a fetch error,
 * same tolerance pattern as the odds/player-list caches.
 */
export function createGolferFormCache(apiKey: string, options: GolferFormCacheOptions = {}): GolferFormCache {
  const tour = options.tour ?? "pga";
  const ttlMs = options.ttlMs ?? 12 * 60 * 60 * 1000;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => Date.now());

  let cached: { eventId: number; fetchedAt: number; data: GolferFormData } | null = null;

  return {
    async get(currentEventId: number) {
      if (cached && cached.eventId === currentEventId && now() - cached.fetchedAt < ttlMs) return cached.data;
      try {
        // Deliberately real wall-clock time here, not the (possibly mocked,
        // for TTL testing) now() above — "which events are completed" needs
        // the actual current date regardless of how cache freshness is measured.
        const data = await fetchGolferFormData(apiKey, tour, currentEventId, new Date(), fetchImpl);
        cached = { eventId: currentEventId, fetchedAt: now(), data };
        return data;
      } catch (err) {
        console.error("DataGolf golfer-form crawl failed:", err);
        return cached && cached.eventId === currentEventId ? cached.data : null;
      }
    },
  };
}
