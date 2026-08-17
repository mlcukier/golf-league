#!/usr/bin/env node
/**
 * Pulls the DataGolf season schedule and creates matching tournaments for a
 * season, via the app's own admin API (so every tournament goes through the
 * same validation/upsert path as typing them in by hand).
 *
 * Tries to identify the 2nd FedEx Cup playoff event (BMW Championship) and
 * mark it isSeasonFinale, stopping the seed there — the league closes at
 * that event. This app's own core/season.ts has `selectSeasonTournaments`
 * that encodes this same start-date/finale truncation, but nothing calls it
 * automatically when tournaments are added one at a time via the admin API,
 * so this script does the filtering itself before posting anything.
 *
 * DataGolf's schedule is date-only (no tee time), so each tournament's pick
 * deadline defaults to 10:00 UTC on its start date — safely before typical
 * PGA Thursday tee times, but a placeholder. Adjust exact deadlines in the
 * Schedule tab if precision matters.
 *
 * Defaults to events DataGolf still marks "upcoming" — already-played events
 * have no pick to make and, since nothing else in this app posts results for
 * them automatically, they'd sit there forever with no results and (per
 * core/emailRouting.ts) block every participant's pick target until someone
 * backfills real results. Set DATAGOLF_INCLUDE_COMPLETED=1 to seed the full
 * year anyway (e.g. to backfill history with real results afterward).
 *
 * Usage:
 *   DATAGOLF_API_KEY=xxx GOLF_APP_EMAIL=you@example.com GOLF_APP_PASSWORD=xxx \
 *     node scripts/seed-schedule.mjs <seasonId> <year>
 *
 * Optional env: GOLF_APP_URL (default http://localhost:8080), DATAGOLF_TOUR (default pga).
 */

const [, , seasonId, yearArg] = process.argv;
if (!seasonId || !yearArg) {
  console.error("Usage: node scripts/seed-schedule.mjs <seasonId> <year>");
  process.exit(1);
}
const year = Number(yearArg);

const dgKey = process.env.DATAGOLF_API_KEY;
const tour = process.env.DATAGOLF_TOUR ?? "pga";
const appUrl = process.env.GOLF_APP_URL ?? "http://localhost:8080";
const appEmail = process.env.GOLF_APP_EMAIL;
const appPassword = process.env.GOLF_APP_PASSWORD;

if (!dgKey) fail("Set DATAGOLF_API_KEY.");
if (!appEmail || !appPassword) fail("Set GOLF_APP_EMAIL and GOLF_APP_PASSWORD (an admin account).");

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

async function fetchSchedule() {
  const url = new URL("https://feeds.datagolf.com/get-schedule");
  url.searchParams.set("tour", tour);
  url.searchParams.set("file_format", "json");
  url.searchParams.set("key", dgKey);
  const res = await fetch(url);
  if (!res.ok) fail(`DataGolf get-schedule failed: ${res.status} ${res.statusText}`);
  const data = await res.json();
  return Array.isArray(data.schedule) ? data.schedule : [];
}

async function login() {
  const res = await fetch(`${appUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: appEmail, password: appPassword }),
  });
  if (!res.ok) fail(`Login failed: ${res.status} ${(await res.json()).error ?? res.statusText}`);
  const cookie = res.headers.get("set-cookie");
  if (!cookie) fail("Login succeeded but no session cookie came back.");
  return cookie.split(";")[0];
}

async function createTournament(cookie, body) {
  const res = await fetch(`${appUrl}/api/tournaments`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) fail(`Failed to create "${body.name}": ${data.error ?? res.statusText}`);
  return data;
}

const FINALE_NAME_HINT = "bmw championship";

async function main() {
  const includeCompleted = process.env.DATAGOLF_INCLUDE_COMPLETED === "1";

  // Finale detection runs against the FULL year's schedule, before the
  // upcoming-only filter below, so it still works even if the finale itself
  // has already been played by the time this runs.
  const fullYear = (await fetchSchedule())
    .filter((e) => new Date(e.start_date).getUTCFullYear() === year)
    .sort((a, b) => new Date(a.start_date) - new Date(b.start_date) || a.event_id - b.event_id);
  if (fullYear.length === 0) fail(`No ${tour} events found for ${year}.`);

  const finaleIndex = fullYear.findIndex((e) => String(e.event_name).toLowerCase().includes(FINALE_NAME_HINT));
  if (finaleIndex < 0) {
    console.warn(
      `Couldn't spot the 2nd FedEx Cup playoff event by name — seeding without a finale set. Mark one as the finale in the Schedule tab.`
    );
  }
  const finaleEventId = finaleIndex >= 0 ? fullYear[finaleIndex].event_id : null;
  const inSeasonFull = finaleIndex >= 0 ? fullYear.slice(0, finaleIndex + 1) : fullYear;

  const events = inSeasonFull.filter((e) => includeCompleted || e.status !== "completed");
  if (events.length === 0) {
    fail(
      `No upcoming ${tour} events left for ${year} (the rest of the season is already played). ` +
        "Set DATAGOLF_INCLUDE_COMPLETED=1 to include already-played events."
    );
  }

  console.log(`Seeding ${events.length} tournaments into season ${seasonId}...`);
  const cookie = await login();

  for (const [i, e] of events.entries()) {
    const isSeasonFinale = e.event_id === finaleEventId;
    const tournament = await createTournament(cookie, {
      seasonId,
      name: e.event_name,
      sequence: i + 1,
      startTime: `${e.start_date}T10:00:00.000Z`,
      isSeasonFinale,
      externalEventId: String(e.event_id),
    });
    console.log(`  ${String(i + 1).padStart(2)}. ${tournament.name}${isSeasonFinale ? "  <- season finale" : ""}`);
  }

  console.log(`\nDone. ${events.length} tournaments created.`);
  console.log("Pick deadlines default to 10:00 UTC on each start date — adjust in the Schedule tab if needed.");
}

main().catch((err) => {
  console.error(err.stack ?? String(err));
  process.exit(1);
});
