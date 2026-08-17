import type { Golfer, GolferResult, Tournament } from "../types.js";
import type { GolfDataProvider } from "./golfDataProvider.js";

const BASE_URL = "https://feeds.datagolf.com";

/**
 * DataGolf implementation of the league's data provider.
 *
 * Endpoints used:
 *   - GET /get-schedule                     season schedule
 *   - GET /field-updates                    this week's confirmed field
 *   - GET /historical-event-data/events     per-event results: earnings, fin_text, FedExCup points
 *
 * Confirmed against a live key: `historical-event-data/event-stats` (the
 * endpoint originally assumed here from docs alone) doesn't exist — it 404s.
 * `historical-raw-data/rounds`, tried next, has real per-round scoring but no
 * earnings field. `historical-event-data/events` (tour/event_id/year) is the
 * one that actually carries per-player `earnings`, `fin_text`, and
 * `fec_points` — verified against a live key on a real completed event.
 * `pickNumber`/`pickString` below stay tolerant of alternate key names as
 * cheap insurance against a future field rename, not because this is in
 * doubt anymore.
 */
export class DataGolfProvider implements GolfDataProvider {
  constructor(
    private apiKey: string,
    private tour: string = "pga",
    private fetchImpl: typeof fetch = fetch
  ) {}

  private async get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(`${BASE_URL}/${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set("file_format", "json");
    url.searchParams.set("key", this.apiKey);

    const response = await this.fetchImpl(url.toString());
    if (!response.ok) {
      throw new Error(`DataGolf ${path} failed: ${response.status} ${response.statusText}`);
    }
    return (await response.json()) as T;
  }

  async getSeasonSchedule(seasonYear: number): Promise<Tournament[]> {
    const raw = await this.get<{ schedule?: unknown[] }>("get-schedule", { tour: this.tour });
    const rows = Array.isArray(raw.schedule) ? raw.schedule : [];

    return rows
      .map((row) => row as Record<string, unknown>)
      .filter((row) => {
        const start = pickString(row, ["start_date", "date"]);
        return start !== null && new Date(start).getUTCFullYear() === seasonYear;
      })
      .map((row, i) => {
        const start = pickString(row, ["start_date", "date"])!;
        return {
          id: `dg-${pickString(row, ["event_id"]) ?? i}`,
          seasonId: "", // assigned by selectSeasonTournaments
          name: pickString(row, ["event_name"]) ?? `Event ${i + 1}`,
          sequence: i + 1,
          startTime: new Date(start).toISOString(),
          isSeasonFinale: false, // set by the admin when the playoff schedule is known
          externalEventId: pickString(row, ["event_id"]) ?? undefined,
        } satisfies Tournament;
      });
  }

  async getTournamentField(_tournamentId: string): Promise<Golfer[]> {
    const raw = await this.get<{ field?: unknown[] }>("field-updates", { tour: this.tour });
    const rows = Array.isArray(raw.field) ? raw.field : [];

    return rows
      .map((row) => row as Record<string, unknown>)
      .map((row) => ({
        id: `dg-${pickString(row, ["dg_id", "player_id"]) ?? pickString(row, ["player_name"]) ?? ""}`,
        name: pickString(row, ["player_name"]) ?? "",
        externalId: pickString(row, ["dg_id", "player_id"]) ?? undefined,
      }))
      .filter((g) => g.name.length > 0);
  }

  async getTournamentResults(tournamentId: string, year: number): Promise<GolferResult[]> {
    const eventId = tournamentId.replace(/^dg-/, "");
    const raw = await this.get<{ event_stats?: unknown[] }>("historical-event-data/events", {
      tour: this.tour,
      event_id: eventId,
      year: String(year),
    });
    const rows = Array.isArray(raw.event_stats) ? raw.event_stats : [];

    return (rows as Record<string, unknown>[]).map((row) =>
      mapEventStatsRow(tournamentId, row)
    );
  }
}

/**
 * Pulls real per-player results for one event directly by tour/event_id/year
 * — what the app's own auto-pull job (jobs/resultsPull.ts) actually calls.
 * Standalone rather than a DataGolfProvider method because it returns rows
 * shaped for the app's own golfer records (matched by name via
 * store.ts's upsertGolfer), not a GolferResult keyed by a synthetic
 * "dg-<id>" — the app's tournaments are identified by their own id, with the
 * DataGolf event_id kept separately on Tournament.externalEventId.
 */
export interface DataGolfResultRow {
  golferName: string;
  earnings: number;
  finishPosition: number | null;
}

export async function fetchDataGolfEventResults(
  apiKey: string,
  tour: string,
  eventId: string,
  year: number,
  fetchImpl: typeof fetch = fetch
): Promise<DataGolfResultRow[]> {
  const url = new URL(`${BASE_URL}/historical-event-data/events`);
  url.searchParams.set("tour", tour);
  url.searchParams.set("event_id", eventId);
  url.searchParams.set("year", String(year));
  url.searchParams.set("file_format", "json");
  url.searchParams.set("key", apiKey);

  const response = await fetchImpl(url.toString());
  if (!response.ok) {
    throw new Error(`DataGolf historical-event-data/events failed: ${response.status} ${response.statusText}`);
  }
  const raw = (await response.json()) as { event_stats?: unknown[] };
  const rows = Array.isArray(raw.event_stats) ? raw.event_stats : [];

  return rows
    .map((row) => row as Record<string, unknown>)
    .map((row) => ({
      golferName: pickString(row, ["player_name"]) ?? "",
      earnings: pickNumber(row, ["earnings", "money", "prize_money", "purse_won"]) ?? 0,
      finishPosition: parseFinishPosition(pickString(row, ["fin_text", "finish_position", "finish"])),
    }))
    .filter((r) => r.golferName.length > 0);
}

/**
 * Normalizes one event-stats row into a GolferResult. Exported so the field
 * mapping can be unit tested against recorded payloads without a live key.
 */
export function mapEventStatsRow(
  tournamentId: string,
  row: Record<string, unknown>
): GolferResult {
  const finishText = pickString(row, ["fin_text", "finish_position", "finish"]);
  const finishPosition = parseFinishPosition(finishText);
  const madeCut = finishPosition !== null;
  const earnings = pickNumber(row, ["earnings", "money", "prize_money", "purse_won"]) ?? 0;

  return {
    tournamentId,
    golferId: `dg-${pickString(row, ["dg_id", "player_id"]) ?? pickString(row, ["player_name"]) ?? ""}`,
    earnings,
    finishPosition,
    madeCut,
    isWin: finishPosition === 1,
    isTop5: finishPosition !== null && finishPosition <= 5,
    isTop10: finishPosition !== null && finishPosition <= 10,
  };
}

/**
 * DataGolf reports finishes as text ("1", "T9", "CUT", "WD", "MDF").
 * Anything non-numeric means no finishing position, which the league treats
 * as a missed cut for the $50 Side Pot fine.
 */
export function parseFinishPosition(text: string | null): number | null {
  if (text === null) return null;
  const match = /^T?(\d+)$/.exec(text.trim());
  return match ? Number(match[1]) : null;
}

function pickString(row: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.length > 0) return value;
    if (typeof value === "number") return String(value);
  }
  return null;
}

function pickNumber(row: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      // Handles "$1,350,000" and "1350000".
      const cleaned = value.replace(/[$,]/g, "").trim();
      if (cleaned.length > 0 && Number.isFinite(Number(cleaned))) return Number(cleaned);
    }
  }
  return null;
}
