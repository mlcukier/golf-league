import type { Golfer, GolferResult, Tournament } from "../types.js";
import type { GolfDataProvider } from "./golfDataProvider.js";

const BASE_URL = "https://feeds.datagolf.com";

/**
 * DataGolf implementation of the league's data provider.
 *
 * Endpoints used:
 *   - GET /get-schedule                          season schedule
 *   - GET /field-updates                          this week's confirmed field
 *   - GET /historical-event-data/event-list       event ids for a tour/year
 *   - GET /historical-raw-data/rounds             per-round scoring + finish
 *
 * Confirmed against a live key: `historical-event-data/event-stats` (the
 * endpoint originally assumed here from docs alone) doesn't exist — it 404s.
 * `historical-raw-data/rounds` is the real per-event results endpoint, and it
 * carries detailed strokes-gained/round stats and `fin_text`, but **no
 * earnings/prize-money field of any kind** on this plan. `pickNumber` below
 * stays tolerant of alternate money key names in case that ever changes (or
 * a higher tier adds one), but as of this check, DataGolf cannot supply
 * money — the admin Results tab's manual paste is the real path.
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

  async getTournamentResults(tournamentId: string): Promise<GolferResult[]> {
    const eventId = tournamentId.replace(/^dg-/, "");
    const raw = await this.get<{ scores?: unknown[]; players?: unknown[] }>(
      "historical-raw-data/rounds",
      { tour: this.tour, event_id: eventId }
    );
    const rows = (Array.isArray(raw.scores) ? raw.scores : raw.players) ?? [];

    return (rows as Record<string, unknown>[]).map((row) =>
      mapEventStatsRow(tournamentId, row)
    );
  }
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
 * as a missed cut for the $50 Side Pot 1 fine.
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
