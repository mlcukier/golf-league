const BASE_URL = "https://feeds.datagolf.com";

export interface FieldUpdateResult {
  /** DataGolf's event_id for whichever event this response covers — the only reliable way to confirm it matches a specific tournament (see below). */
  eventId: string;
  eventName: string;
  /** DataGolf's "Last, First" player_name for every golfer currently in the field. */
  golferNames: string[];
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
  const raw = (await response.json()) as { event_id?: number | string; event_name?: string; field?: unknown[] };
  const rows = Array.isArray(raw.field) ? raw.field : [];

  const golferNames = rows
    .map((row) => row as Record<string, unknown>)
    .map((row) => (typeof row.player_name === "string" ? row.player_name : null))
    .filter((name): name is string => name !== null && name.length > 0);

  return {
    eventId: raw.event_id !== undefined ? String(raw.event_id) : "",
    eventName: raw.event_name ?? "",
    golferNames,
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
