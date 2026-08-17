#!/usr/bin/env node
/**
 * Answers one question: does your DataGolf plan return REAL PRIZE MONEY per
 * golfer per event, as opposed to only FedEx Cup / DG points?
 *
 * No build step, no dependencies. On your box:
 *
 *   DATAGOLF_API_KEY=xxxx node scripts/verify-datagolf.mjs
 *
 * Optionally pin an event:  ... verify-datagolf.mjs <event_id> <year>
 *
 * It prints the raw fields DataGolf returns, then classifies them into money
 * vs points and sanity-checks the magnitudes — a PGA winner earns ~$1-4M but
 * scores only ~500-750 FedEx points, so the two are easy to tell apart.
 */

const key = process.env.DATAGOLF_API_KEY;
const tour = process.env.DATAGOLF_TOUR ?? "pga";
const [, , eventIdArg, yearArg] = process.argv;

const MONEY_HINTS = ["earning", "money", "prize", "purse", "winnings", "payout"];
const POINTS_HINTS = ["fedex", "point", "pts", "dg_points", "owgr"];

const redact = (s) => (key ? String(s).replaceAll(key, "«KEY»") : String(s));

async function getJson(path, params) {
  const url = new URL(`https://feeds.datagolf.com/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("file_format", "json");
  url.searchParams.set("key", key);

  const res = await fetch(url.toString());
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${path} -> HTTP ${res.status} ${res.statusText}\n${redact(text).slice(0, 400)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${path} returned non-JSON:\n${redact(text).slice(0, 400)}`);
  }
}

/** DataGolf nests result rows under varying keys; find the first array of objects. */
function firstRowArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    for (const value of Object.values(payload)) {
      if (Array.isArray(value) && value.length && typeof value[0] === "object") return value;
    }
  }
  return [];
}

export const numeric = (v) => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const cleaned = v.replace(/[$,]/g, "").trim();
    if (cleaned && Number.isFinite(Number(cleaned))) return Number(cleaned);
  }
  return null;
};

const matches = (k, hints) => hints.some((h) => k.toLowerCase().includes(h));

/**
 * Splits a result row's fields into money-like and points-like, and decides
 * whether any money field is credible. A PGA winner clears $100k in prize
 * money but scores only ~500-750 FedEx points, so the magnitude check is
 * what stops a points column from being mistaken for winnings.
 */
export function classifyRow(row) {
  const moneyFields = Object.keys(row).filter((k) => matches(k, MONEY_HINTS));
  const pointsFields = Object.keys(row).filter(
    (k) => matches(k, POINTS_HINTS) && !matches(k, MONEY_HINTS)
  );
  const credible = moneyFields
    .map((k) => [k, numeric(row[k])])
    .filter(([, n]) => n !== null && n >= 100_000);

  return {
    moneyFields,
    pointsFields,
    credible,
    verdict: credible.length ? "MONEY" : moneyFields.length ? "SUSPECT" : "NONE",
  };
}

async function main() {
  if (!key) {
    console.error(
      "Set DATAGOLF_API_KEY first:\n  DATAGOLF_API_KEY=xxxx node scripts/verify-datagolf.mjs"
    );
    process.exit(1);
  }

  let eventId = eventIdArg;
  let year = yearArg;
  let eventName = "";

  if (!eventId) {
    console.log(`Fetching completed events for tour=${tour}...`);
    const events = firstRowArray(await getJson("historical-event-data/event-list", { tour }));
    if (!events.length) throw new Error("event-list returned no events — likely a plan/tier issue.");

    const wanted = year ? events.filter((e) => String(e.calendar_year ?? e.year) === year) : events;
    const chosen = wanted.at(-1) ?? events.at(-1);
    eventId = String(chosen.event_id);
    year = String(chosen.calendar_year ?? chosen.year ?? new Date().getUTCFullYear());
    eventName = chosen.event_name ?? "";
    console.log(`Using event_id=${eventId} year=${year} ${eventName}\n`);
  }

  const stats = await getJson("historical-event-data/event-stats", { tour, event_id: eventId, year });
  const rows = firstRowArray(stats);
  if (!rows.length) {
    console.log("No result rows returned. Raw payload (truncated):");
    console.log(redact(JSON.stringify(stats)).slice(0, 800));
    process.exit(2);
  }

  // The winner's row shows the clearest money-vs-points contrast.
  const winner =
    rows.find((r) => String(r.fin_text ?? r.finish_position ?? "").trim() === "1") ?? rows[0];

  console.log(`Fields on the winner's row (${winner.player_name ?? "unknown"}):`);
  for (const [k, v] of Object.entries(winner)) console.log(`  ${k}: ${JSON.stringify(v)}`);

  const { moneyFields, pointsFields, credible } = classifyRow(winner);

  console.log("\n" + "=".repeat(64));
  console.log(`MONEY-LIKE fields:  ${moneyFields.length ? moneyFields.join(", ") : "(none)"}`);
  console.log(`POINTS-LIKE fields: ${pointsFields.length ? pointsFields.join(", ") : "(none)"}`);

  if (credible.length) {
    console.log("\n✅ REAL PRIZE MONEY IS AVAILABLE on your plan.");
    for (const [k, n] of credible) {
      console.log(`   ${k} = $${n.toLocaleString()}  <- use this field`);
    }
    console.log("\nSet this in the app config as the earnings field and you're done.");
  } else if (moneyFields.length) {
    console.log("\n⚠️  Money-named field(s) found, but the winner's value looks too small");
    console.log("   to be prize money (points, or a zero-filled column on this tier):");
    for (const k of moneyFields) console.log(`   ${k} = ${JSON.stringify(winner[k])}`);
    console.log("\n   Treat this as NOT usable until you confirm with DataGolf support.");
  } else {
    console.log("\n❌ NO earnings field on this response — only points-style columns.");
    console.log("   Either this endpoint doesn't carry money on your subscription tier,");
    console.log("   or earnings live on a different endpoint. Ask DataGolf support:");
    console.log('   "Does my plan include prize money (earnings) in historical-event-data/event-stats?"');
    console.log("\n   The app works fine without it — paste results in the admin Results tab.");
  }
  console.log("=".repeat(64));
}

// Only hit the network when run directly, so the classifier can be imported
// and tested offline.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  main().catch((error) => {
    console.error("\nFailed: " + redact(error.message));
    console.error("\nIf this is a 401/403, the key or the plan tier is the issue.");
    process.exit(1);
  });
}
