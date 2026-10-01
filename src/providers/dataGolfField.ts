const BASE_URL = "https://feeds.datagolf.com";

export interface FieldUpdateResult {
  /** DataGolf's event_id for whichever event this response covers — the only reliable way to confirm it matches a specific tournament (see below). */
  eventId: string;
  eventName: string;
  /** DataGolf's "Last, First" player_name for every golfer currently in the field. */
  golferNames: string[];
  /**
   * The earliest round-1 tee time across the whole field, as a UTC ISO
   * instant — i.e. the real pick deadline. Null until DataGolf posts tee
   * times (usually the Tuesday before), or if the response has no usable
   * `tz_offset` to turn its course-local times into an instant.
   */
  firstTeeTime: string | null;
}

/**
 * DataGolf's `teetime` is course-local wall-clock ("2026-10-01 07:35") with
 * the course's UTC offset given once at the top level as `tz_offset`, in
 * seconds (e.g. -21600 for MDT). Subtracting the offset gives UTC.
 */
function earliestRoundOneTeeTime(rows: Record<string, unknown>[], tzOffsetSeconds: unknown): string | null {
  if (typeof tzOffsetSeconds !== "number" || !Number.isFinite(tzOffsetSeconds)) return null;
  let earliest: number | null = null;
  for (const row of rows) {
    const teetimes = Array.isArray(row.teetimes) ? row.teetimes : [];
    for (const tt of teetimes as Record<string, unknown>[]) {
      if (tt.round_num !== 1 || typeof tt.teetime !== "string") continue;
      const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/.exec(tt.teetime);
      if (!m) continue;
      const localAsUtc = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!);
      const utc = localAsUtc - tzOffsetSeconds * 1000;
      if (earliest === null || utc < earliest) earliest = utc;
    }
  }
  return earliest === null ? null : new Date(earliest).toISOString();
}

/**
 * Pulls DataGolf's confirmed field for whichever tour event it currently has
 * loaded. Like `preds/pre-tournament` and `preds/in-play`, there's no way to
 * request a *specific* event — but unlike those two, this response's
 * `event_id` is confirmed live to match this app's own `externalEventId`
 * (both ultimately DataGolf's event id), so callers can match on that
 * directly rather than a fuzzy event-name string compare.
 */
export async function fetchFieldUpdate(
  apiKey: string,
  tour: string = "pga",
  fetchImpl: typeof fetch = fetch
): Promise<FieldUpdateResult> {
  const url = new URL(`${BASE_URL}/field-updates`);
  url.searchParams.set("tour", tour);
  url.searchParams.set("file_format", "json");
  url.searchParams.set("key", apiKey);

  const response = await fetchImpl(url.toString());
  if (!response.ok) {
    throw new Error(`DataGolf field-updates failed: ${response.status} ${response.statusText}`);
  }
  const raw = (await response.json()) as {
    event_id?: number | string;
    event_name?: string;
    tz_offset?: unknown;
    field?: unknown[];
  };
  const rows = (Array.isArray(raw.field) ? raw.field : []).map((row) => row as Record<string, unknown>);

  const golferNames = rows
    .map((row) => (typeof row.player_name === "string" ? row.player_name : null))
    .filter((name): name is string => name !== null && name.length > 0);

  return {
    eventId: raw.event_id !== undefined ? String(raw.event_id) : "",
    eventName: raw.event_name ?? "",
    golferNames,
    firstTeeTime: earliestRoundOneTeeTime(rows, raw.tz_offset),
  };
}

/**
 * Only returns a field when it's actually for the named tournament — never
 * silently applies whichever week DataGolf currently has loaded to the wrong
 * tournament just because both happen to have a field.
 */
export function fieldForTournament(result: FieldUpdateResult, externalEventId: string | undefined): string[] | null {
  if (!externalEventId || result.eventId !== externalEventId) return null;
  return result.golferNames;
}
