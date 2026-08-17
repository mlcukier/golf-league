#!/usr/bin/env node
/**
 * Reusable test-data seeder: fills a season with a plausible random history —
 * weekly tournaments, fields, results (wins, missed cuts, top-10s), picks,
 * and Hearn lists for a roster of participants — so the rule engine,
 * standings, and every pot (Side Pot, the Greller, TOCC) can be exercised
 * end-to-end without waiting for a real season to actually play out.
 *
 * Writes straight to the JSON store (same atomic temp-file-then-rename as
 * src/store/jsonStore.ts) rather than going through the HTTP API, so it
 * works without a running server and can seed a lot of history quickly.
 * Safe to re-run: it only ever adds tournaments for dates that don't already
 * have one in the target season, and only creates participants that don't
 * already exist (matched by name or nickname).
 *
 * Tournament names come from a built-in list modeled on a typical PGA Tour
 * calendar, in order, so the schedule reads as plausible even without
 * network access. Pass --use-datagolf (with DATAGOLF_API_KEY set) to pull
 * real event names/dates from DataGolf's schedule instead — win/loss
 * outcomes and earnings are always synthesized either way, since DataGolf
 * doesn't expose prize money on this plan (see README) and this app's own
 * Results tab is manual-paste for the same reason.
 *
 * SAFETY: refuses to touch a league unless it's flagged isTest (pass
 * --mark-test to flip that flag as part of this run). Never point this at
 * a real league — it invents fake results, picks, and money.
 *
 * Usage:
 *   node scripts/seed-history.mjs [options]
 *
 * Options:
 *   --db <path>              JSON store path (default: $LEAGUE_DB or ./data/league.json)
 *   --league <id>             League to seed (default: the sole isTest league)
 *   --season <id>             Season to seed (default: that league's ACTIVE season)
 *   --from <YYYY-MM-DD>       First historical week (default: season.startDate)
 *   --participants "A,B,C"    Names/nicknames of new participants to create (skips any that already exist)
 *   --tocc "A,B,C"            Which participants (by name or nickname) are TOCC members this run
 *                             (default: existing entries untouched; newly created participants default to TOCC members)
 *   --missed-cut-rate <0..1>  Probability any given pick misses the cut (default 0.22)
 *   --min-missed-cuts <n>     Guarantee at least this many missed-cut results across the run (default 6)
 *   --greller-wins <n>        Guarantee at least this many unique-pick Greller-winning weeks (default 3)
 *   --seed <int>              RNG seed, for a reproducible run (default: random)
 *   --mark-test               Flip the resolved league's isTest flag to true before seeding
 *   --use-datagolf            Pull real schedule names/dates from DataGolf (needs DATAGOLF_API_KEY)
 *   --dry-run                 Compute and print a summary without writing anything
 *
 * Example (what seeded this app's demo test league):
 *   node scripts/seed-history.mjs --mark-test \
 *     --participants "Dreifuss,Selbst,Goberstein,Freid" \
 *     --tocc "Dreifuss,Selbst,Goberstein" \
 *     --from 2026-01-15 --seed 20260817
 */

import { readFile, writeFile, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function camel(key) {
  return key.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
}

function parseArgs(argv) {
  const BOOLEAN_FLAGS = new Set(["mark-test", "dry-run", "use-datagolf"]);
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    if (BOOLEAN_FLAGS.has(key)) {
      args[camel(key)] = true;
      continue;
    }
    args[camel(key)] = argv[++i];
  }
  return args;
}

function splitList(s) {
  return (s ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

// ---- RNG (mulberry32 — small, seedable, no dependency) ----------------------

function makeRng(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rand, min, max) {
  return Math.floor(rand() * (max - min + 1)) + min;
}

function choice(rand, arr) {
  return arr[Math.floor(rand() * arr.length)];
}

function shuffle(rand, arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function id(prefix) {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// ---- builtin fallback schedule (used unless --use-datagolf succeeds) -------

const BUILTIN_SCHEDULE = [
  "The Sony Open in Hawaii",
  "The American Express",
  "Farmers Insurance Open",
  "AT&T Pebble Beach Pro-Am",
  "WM Phoenix Open",
  "The Genesis Invitational",
  "Mexico Open at Vidanta",
  "Cognizant Classic in The Palm Beaches",
  "Arnold Palmer Invitational",
  "THE PLAYERS Championship",
  "Valspar Championship",
  "Texas Children's Houston Open",
  "Valero Texas Open",
  "Masters Tournament",
  "RBC Heritage",
  "Zurich Classic of New Orleans",
  "CJ Cup Byron Nelson",
  "Wells Fargo Championship",
  "PGA Championship",
  "Charles Schwab Challenge",
  "the Memorial Tournament",
  "RBC Canadian Open",
  "U.S. Open",
  "Travelers Championship",
  "John Deere Classic",
  "Rocket Mortgage Classic",
  "3M Open",
  "Genesis Scottish Open",
  "The Open Championship",
  "Barracuda Championship",
  "Wyndham Championship",
  "FedEx St. Jude Championship",
];

async function fetchDataGolfSchedule(year) {
  const key = process.env.DATAGOLF_API_KEY;
  if (!key) {
    console.warn("--use-datagolf passed but DATAGOLF_API_KEY isn't set — falling back to the builtin schedule.");
    return null;
  }
  const url = new URL("https://feeds.datagolf.com/get-schedule");
  url.searchParams.set("tour", "pga");
  url.searchParams.set("file_format", "json");
  url.searchParams.set("key", key);
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const data = await res.json();
    const rows = (Array.isArray(data.schedule) ? data.schedule : [])
      .filter((e) => new Date(e.start_date).getUTCFullYear() === year)
      .sort((a, b) => new Date(a.start_date) - new Date(b.start_date));
    return rows.map((e) => ({ name: e.event_name, date: e.start_date }));
  } catch (err) {
    console.warn(`DataGolf schedule fetch failed (${err.message}) — falling back to the builtin schedule.`);
    return null;
  }
}

// ---- synthetic outcomes ------------------------------------------------------

function earningsForPosition(rand, pos) {
  if (pos === 1) return randInt(rand, 1_800_000, 3_600_000);
  if (pos === 2) return randInt(rand, 900_000, 1_400_000);
  if (pos <= 5) return randInt(rand, 450_000, 800_000);
  if (pos <= 10) return randInt(rand, 180_000, 400_000);
  if (pos <= 20) return randInt(rand, 70_000, 170_000);
  if (pos <= 30) return randInt(rand, 30_000, 65_000);
  return randInt(rand, 12_000, 28_000);
}

// ---- main -------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dbPath = args.db || process.env.LEAGUE_DB || "./data/league.json";
  const rand = makeRng(args.seed ? Number(args.seed) : (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0);

  const raw = JSON.parse(await readFile(dbPath, "utf8"));

  // ---- resolve league + season ----
  let league;
  if (args.league) {
    league = raw.leagues.find((l) => l.id === args.league);
    if (!league) fail(`No league ${args.league}`);
  } else {
    const testLeagues = raw.leagues.filter((l) => l.isTest);
    if (testLeagues.length === 1) league = testLeagues[0];
    else if (raw.leagues.length === 1) league = raw.leagues[0];
    else fail(`Multiple leagues exist — pass --league <id>. Leagues:\n` + raw.leagues.map((l) => `  ${l.id}  ${l.name}${l.isTest ? " [test]" : ""}`).join("\n"));
  }
  if (args.markTest) league.isTest = true;
  if (!league.isTest) {
    fail(`League "${league.name}" is not flagged isTest — refusing to seed fake history into it.\nPass --mark-test if this really is a test/throwaway league.`);
  }

  let season;
  if (args.season) {
    season = raw.seasons.find((s) => s.id === args.season && s.leagueId === league.id);
    if (!season) fail(`No season ${args.season} in league ${league.id}`);
  } else {
    const active = raw.seasons.filter((s) => s.leagueId === league.id && s.status === "ACTIVE");
    if (active.length !== 1) {
      fail(`Expected exactly one ACTIVE season in league "${league.name}", found ${active.length}. Pass --season <id>.`);
    }
    season = active[0];
  }

  const fromDate = new Date(`${args.from || season.startDate}T00:00:00.000Z`);
  const missedCutRate = args.missedCutRate !== undefined ? Number(args.missedCutRate) : 0.22;
  const minMissedCuts = args.minMissedCuts !== undefined ? Number(args.minMissedCuts) : 6;
  const grellerWinsTarget = args.grellerWins !== undefined ? Number(args.grellerWins) : 3;

  // ---- participants ----
  const findParticipant = (nameOrNick) =>
    raw.participants.find((p) => p.name === nameOrNick || p.nickname === nameOrNick);

  const requestedNew = splitList(args.participants);
  const toccNames = args.tocc !== undefined ? splitList(args.tocc) : null;
  const createdParticipants = [];

  for (const nm of requestedNew) {
    let p = findParticipant(nm);
    if (!p) {
      let email = `${slugify(nm)}@test.golfleague.local`;
      if (raw.participants.some((x) => x.email === email)) email = `${slugify(nm)}-${randomUUID().slice(0, 4)}@test.golfleague.local`;
      p = {
        id: id("p"),
        name: nm,
        nickname: null,
        email,
        isAdmin: false,
        passwordHash: null,
        passwordSetAt: null,
      };
      raw.participants.push(p);
      createdParticipants.push(p);
    }
    if (!raw.seasonEntries.some((e) => e.seasonId === season.id && e.participantId === p.id)) {
      raw.seasonEntries.push({
        seasonId: season.id,
        participantId: p.id,
        isTOCCMember: toccNames ? toccNames.includes(nm) : true,
      });
    }
  }

  if (toccNames) {
    for (const entry of raw.seasonEntries.filter((e) => e.seasonId === season.id)) {
      const p = raw.participants.find((x) => x.id === entry.participantId);
      entry.isTOCCMember = toccNames.includes(p.name) || toccNames.includes(p.nickname);
    }
  }

  const rosterParticipants = raw.seasonEntries
    .filter((e) => e.seasonId === season.id)
    .map((e) => raw.participants.find((p) => p.id === e.participantId))
    .filter(Boolean);

  // ---- schedule ----
  const seasonTournaments = raw.tournaments.filter((t) => t.seasonId === season.id);
  const finale = seasonTournaments.find((t) => t.isSeasonFinale) || null;
  const finaleStart = finale ? new Date(finale.startTime) : null;
  const cutoff = finaleStart ? new Date(finaleStart.getTime() - 5 * 86400000) : null;
  const existingDates = new Set(seasonTournaments.map((t) => t.startTime.slice(0, 10)));

  let scheduleSource = BUILTIN_SCHEDULE.map((name, i) => ({ name, date: null, i }));
  if (args.useDatagolf) {
    const real = await fetchDataGolfSchedule(fromDate.getUTCFullYear());
    if (real && real.length > 0) scheduleSource = real;
  }

  const newTournaments = [];
  let cursor = new Date(fromDate);
  let nameIdx = 0;
  while (true) {
    if (cutoff && cursor >= cutoff) break;
    if (!cutoff && newTournaments.length >= 26) break;
    const dateStr = cursor.toISOString().slice(0, 10);
    if (!existingDates.has(dateStr)) {
      const entry = scheduleSource[nameIdx % scheduleSource.length];
      const name = entry ? entry.name : `PGA Tour Event ${nameIdx + 1}`;
      newTournaments.push({
        id: id("t"),
        seasonId: season.id,
        name,
        sequence: 0, // fixed up below
        startTime: new Date(cursor.getTime() + 10 * 3600000).toISOString(),
        isSeasonFinale: false,
      });
    }
    nameIdx++;
    cursor = new Date(cursor.getTime() + 7 * 86400000);
  }

  if (newTournaments.length === 0) fail("No new tournament dates to seed — check --from against the season's existing schedule.");

  // Renumber every non-finale tournament in the season chronologically, then
  // put the finale last, so quarter-boundary math over the whole season stays correct.
  const nonFinaleExisting = seasonTournaments.filter((t) => !t.isSeasonFinale);
  const allNonFinale = [...nonFinaleExisting, ...newTournaments].sort(
    (a, b) => new Date(a.startTime) - new Date(b.startTime)
  );
  allNonFinale.forEach((t, i) => void (t.sequence = i + 1));
  if (finale) finale.sequence = allNonFinale.length + 1;

  const golferPool = raw.golfers;
  for (const t of newTournaments) {
    raw.fields[t.id] = golferPool.map((g) => g.id);
  }

  // ---- picks + results ----
  const usedGolfers = new Map();
  for (const p of rosterParticipants) {
    usedGolfers.set(
      p.id,
      new Set(raw.picks.filter((pk) => pk.participantId === p.id && pk.seasonId === season.id).map((pk) => pk.golferId))
    );
  }

  const weeksData = [];

  for (const t of newTournaments) {
    const weekPicks = [];
    for (const p of rosterParticipants) {
      const used = usedGolfers.get(p.id);
      const available = golferPool.filter((g) => !used.has(g.id));
      if (available.length === 0) continue; // pool exhausted for this participant — skip the week for them
      const g = choice(rand, available);
      used.add(g.id);
      const pick = {
        participantId: p.id,
        seasonId: season.id,
        tournamentId: t.id,
        golferId: g.id,
        submittedAt: new Date(new Date(t.startTime).getTime() - randInt(rand, 2, 96) * 3600000).toISOString(),
        source: rand() < 0.08 ? "hearn" : "web",
      };
      raw.picks.push(pick);
      weekPicks.push(pick);
    }

    const distinctGolferIds = [...new Set(weekPicks.map((pk) => pk.golferId))];
    const missedCutIds = new Set(distinctGolferIds.filter(() => rand() < missedCutRate));
    const madeCutIds = distinctGolferIds.filter((g) => !missedCutIds.has(g));

    // Real odds that one of 5 picks landed on the actual tournament winner
    // (out of a ~50-player weekly field) are closer to 1-in-8 than 1-in-2 —
    // the --greller-wins floor below tops this up if it runs unluckily low.
    let winnerGolferId = madeCutIds.length > 0 && rand() < 0.13 ? choice(rand, madeCutIds) : null;
    const others = madeCutIds.filter((g) => g !== winnerGolferId);
    const positions = shuffle(rand, others.map((_, i) => i + 2));

    const results = [];
    for (const gid of distinctGolferIds) {
      let result;
      if (missedCutIds.has(gid)) {
        result = { tournamentId: t.id, golferId: gid, earnings: 0, finishPosition: null, madeCut: false, isWin: false, isTop5: false, isTop10: false };
      } else {
        const pos = gid === winnerGolferId ? 1 : positions[others.indexOf(gid)];
        result = {
          tournamentId: t.id,
          golferId: gid,
          earnings: earningsForPosition(rand, pos),
          finishPosition: pos,
          madeCut: true,
          isWin: pos === 1,
          isTop5: pos <= 5,
          isTop10: pos <= 10,
        };
      }
      raw.results.push(result);
      results.push(result);
    }

    weeksData.push({ tournament: t, weekPicks, results });
  }

  // ---- guarantee a minimum of missed cuts ----
  let missedCutCount = weeksData.flatMap((w) => w.results).filter((r) => !r.madeCut).length;
  if (missedCutCount < minMissedCuts) {
    const flippable = shuffle(
      rand,
      weeksData.flatMap((w) => w.results).filter((r) => r.madeCut && r.finishPosition > 10)
    );
    for (const r of flippable) {
      if (missedCutCount >= minMissedCuts) break;
      r.madeCut = false;
      r.finishPosition = null;
      r.earnings = 0;
      r.isWin = false;
      r.isTop5 = false;
      r.isTop10 = false;
      missedCutCount++;
    }
  }

  // ---- guarantee a minimum of unique-pick Greller-winning weeks ----
  const isUniqueWinnerWeek = (w) => {
    const winResult = w.results.find((r) => r.isWin);
    if (!winResult) return false;
    return w.weekPicks.filter((pk) => pk.golferId === winResult.golferId).length === 1;
  };
  let grellerWins = weeksData.filter(isUniqueWinnerWeek).length;
  if (grellerWins < grellerWinsTarget) {
    for (const w of shuffle(rand, weeksData)) {
      if (grellerWins >= grellerWinsTarget) break;
      if (isUniqueWinnerWeek(w)) continue;
      const counts = new Map();
      for (const pk of w.weekPicks) counts.set(pk.golferId, (counts.get(pk.golferId) ?? 0) + 1);
      const uniquePicks = w.weekPicks.filter((pk) => counts.get(pk.golferId) === 1);
      if (uniquePicks.length === 0) continue;
      const target = choice(rand, uniquePicks);

      for (const r of w.results) r.isWin = false;
      let r = w.results.find((x) => x.golferId === target.golferId);
      if (!r) {
        r = { tournamentId: w.tournament.id, golferId: target.golferId, earnings: 0, finishPosition: null, madeCut: false, isWin: false, isTop5: false, isTop10: false };
        raw.results.push(r);
        w.results.push(r);
      }
      r.madeCut = true;
      r.finishPosition = 1;
      r.isWin = true;
      r.isTop5 = true;
      r.isTop10 = true;
      r.earnings = earningsForPosition(rand, 1);
      grellerWins++;
    }
  }

  // ---- Hearn lists for newly created participants ----
  for (const p of createdParticipants) {
    shuffle(rand, golferPool)
      .slice(0, 6)
      .forEach((g, i) => {
        raw.hearnPicks.push({ seasonId: season.id, participantId: p.id, golferId: g.id, rank: i + 1 });
      });
  }

  raw.tournaments.push(...newTournaments);

  // ---- summary ----
  missedCutCount = weeksData.flatMap((w) => w.results).filter((r) => !r.madeCut).length;
  grellerWins = weeksData.filter(isUniqueWinnerWeek).length;
  console.log(`League: ${league.name} (${league.id})${league.isTest ? " [test]" : ""}`);
  console.log(`Season: ${season.year} (${season.id})`);
  console.log(`New participants: ${createdParticipants.length ? createdParticipants.map((p) => p.name).join(", ") : "none"}`);
  console.log(`Roster size: ${rosterParticipants.length}`);
  console.log(`TOCC members: ${rosterParticipants.filter((p) => raw.seasonEntries.find((e) => e.seasonId === season.id && e.participantId === p.id)?.isTOCCMember).map((p) => p.nickname || p.name).join(", ")}`);
  console.log(`New tournaments: ${newTournaments.length} (${newTournaments[0].name} ${newTournaments[0].startTime.slice(0, 10)} .. ${newTournaments.at(-1).name} ${newTournaments.at(-1).startTime.slice(0, 10)})`);
  console.log(`New picks: ${weeksData.flatMap((w) => w.weekPicks).length}`);
  console.log(`Missed-cut results: ${missedCutCount}`);
  console.log(`Greller-winning weeks: ${grellerWins}`);

  if (args.dryRun) {
    console.log("\n--dry-run passed — nothing written.");
    return;
  }

  const tmp = `${dbPath}.tmp`;
  await writeFile(tmp, JSON.stringify(raw, null, 2), "utf8");
  await rename(tmp, dbPath);
  console.log(`\nWrote ${dbPath}`);
}

main().catch((err) => {
  console.error(err.stack ?? String(err));
  process.exit(1);
});
