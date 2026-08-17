# Golf League App

Season-long "one and done" golf pool: each participant picks a different PGA
Tour golfer every week and earns that golfer's tournament winnings. The season
opens Jan 1 and closes with the second FedEx Cup playoff event. Tracks the
season race, four quarterly races, three side pots (Side Pot 1, the Greller,
TOCC), and Hearn-pick fallbacks — across multiple years and multiple leagues.

Participants interact entirely by email. Administration happens on a web page
served on the local network.

## Quick start

```bash
npm install
npm test                 # 74 unit tests over the rule engine
npm run build
LEAGUE_DB=./data/league.json ADMIN_PORT=8080 ADMIN_TOKEN=pick-a-secret npm start
```

Then open `http://<your-box>:8080/?token=pick-a-secret` from any device on the
LAN. The admin page has no build step and works on a phone.

## League rules as implemented

| Rule | Behavior |
| --- | --- |
| **One and done** | Each participant may use each golfer at most once **per season**. The pool resets each year. |
| **Weekly scoring** | Points = the selected golfer's prize money that week. |
| **Pick deadline** | A pick email must be **received strictly before the tournament's start time**. At/after the start is rejected. |
| **Season winner** | Highest total earnings across the season. |
| **Quarterly winners** | The season's tournaments split into **4 equal segments by event count**; highest earnings in each. |
| **Side Pot 1** | Funded by $50 per missed cut. Won by the participant whose picks produced the most top-10s; ties break on top-5s, then wins. |
| **The Greller** | $10/participant/week. Won when a participant picks the tournament winner **and nobody else picked that golfer**. Pot resets on a win, rolls over otherwise. |
| **TOCC side action** | Among the TOCC subgroup only. Best weekly earnings wins **$100 from each** other member; 2nd place breaks even. Stake **doubles to $200** each when the winning pick also won the tournament outright. |
| **Hearn picks** | A static, ordered fallback list per participant. If no pick arrives before the start, the engine assigns the highest-ranked Hearn golfer that is unused this season and in the field. |

### One-and-done is absolute

The rule is enforced in three independent places, and there is no override
path anywhere in the system:

1. `validatePick` reports **every** violation rather than stopping at the
   first, so an admin override of a soft rule can't mask a duplicate golfer.
2. `blockingReasons` treats only `PAST_DEADLINE` and `GOLFER_NOT_IN_FIELD` as
   overridable — the two one-and-done reasons are never in that set.
3. `resolveHearnPick` skips already-used Hearn candidates and returns `null`
   (participant takes a zero) rather than ever burning a golfer twice.

A regression test pins each of these, including the "forced late pick hides a
duplicate golfer" bug that an end-to-end run caught during development.

## Data source: DataGolf — NOT YET VERIFIED

**Status: unconfirmed.** DataGolf's published docs describe a **Historical
Event Data** category with an *Event Finishes, Earnings & Points* endpoint,
which is where prize money would live:

- `GET /historical-event-data/event-list?tour=pga` — event ids per season
- `GET /historical-event-data/event-stats?tour=pga&event_id=…&year=…` —
  finishes, earnings, FedEx Cup points, DG points
- `GET /get-schedule`, `GET /field-updates` — schedule and this week's field

That comes from their documentation, **not from a live response**. All
DataGolf hosts (`datagolf.com`, `am.datagolf.org`, `feeds.datagolf.com`) are
blocked by the egress policy of the environment this was built in, so no
actual payload was ever inspected. Two open questions remain:

1. **Does the response carry real dollars, or only points?** An endpoint
   documented as "Earnings & Points" could still return only points on a given
   plan.
2. **Is historical event data included in your subscription tier?**

### Answering both in ten seconds

```bash
DATAGOLF_API_KEY=xxxx npm run verify:datagolf
```

Zero dependencies, no build step. It pulls a completed event, prints every
field on the winner's row, and classifies them into money-like vs points-like
— then sanity-checks magnitude, since a PGA winner takes home $1-4M but scores
only ~500-750 FedEx points. Output is one of:

- `✅ REAL PRIZE MONEY IS AVAILABLE` plus the exact field name to use
- `⚠️ SUSPECT` — a money-named field whose value is too small to be winnings
  (a zero-filled or points-valued column)
- `❌ NO earnings field` — points only, with the question to send DataGolf support

The classifier itself is unit tested (`src/test/verifyClassifier.test.ts`),
including the `fedex_points_earned` trap where a field name contains "earn"
but is really points.

`src/providers/dataGolfProvider.ts` already accepts `earnings`, `money`,
`prize_money`, `purse_won`, `winnings`, or `payout`, and parses `"$1,350,000"`
as well as raw numbers — so once you know the field name it likely needs no
change at all.

**If earnings turn out not to be available**, nothing is blocked: the admin
**Results** tab accepts pasted results (`Golfer, earnings, finish`) with no API
involved. Prize money is also printed on every tournament leaderboard, so a
weekly copy-paste is a viable permanent fallback.

## Multi-year and test leagues

- **Test league** — one click in the admin *Seasons* tab creates an isolated
  league running from today through the end of the year, optionally cloning
  your current roster. It exercises every real code path; `isTest` keeps its
  money separate. Stakes can be set to $0.
- **New year** — *Roll to \<year\>* creates a fresh season in the same league,
  carrying the roster and money rules forward. Prior seasons keep every
  tournament, pick, and result; only the one-and-done pool resets. Both the
  JSON store and the Prisma schema scope one-and-done to `seasonId`, so this
  is structural rather than a convention.

## Project layout

```
src/
  types.ts                  Domain types (League, Season, Pick, HearnPick, …)
  core/
    scoring.ts               Season + quarterly standings
    oneAndDone.ts            Pick validation; overridable-reason policy
    hearn.ts                 Hearn fallback engine + dead-entry detection
    season.ts                Season lifecycle: create, test league, roll over
    sidePot1.ts              Missed-cut pot, most-top-10s winner
    greller.ts               Weekly pot, unique-winning-pick payout
    tocc.ts                  TOCC subgroup side action
    report.ts                Composes all standings + pots into one view
  providers/
    golfDataProvider.ts      Adapter interface
    dataGolfProvider.ts      DataGolf implementation
    mockGolfDataProvider.ts  In-memory stand-in
  scripts/verify-datagolf.mjs  (repo root) Confirms money vs points on your plan
  store/
    store.ts                 LeagueData shape + season-scoped read helpers
    jsonStore.ts             Atomic JSON-file store (+ in-memory for tests)
  admin/
    server.ts                LAN admin HTTP API
    html.ts                  The admin single-page app
  email/
    parser.ts                Inbound command parsing
    templates.ts             Outbound reply text
  test/                      74 tests
prisma/schema.prisma         Optional Postgres model (documented upgrade path)
```

`src/core/*` is pure and framework-free — no DB, no network — so every rule is
unit tested in isolation.

## Configuration

| Env var | Default | Purpose |
| --- | --- | --- |
| `LEAGUE_DB` | `./data/league.json` | League database file |
| `ADMIN_PORT` | `8080` | Admin HTTP port |
| `ADMIN_HOST` | `0.0.0.0` | Bind address (LAN-visible by default) |
| `ADMIN_TOKEN` | *(unset)* | Shared secret; without it anyone on the LAN can edit |
| `DATAGOLF_API_KEY` | — | Used by the verify script and the provider |

## Still to build

The rule engine, store, and admin UI are done and tested end to end. What
remains needs credentials or a decision from you:

- **Email transport.** `src/email/parser.ts` and `templates.ts` handle the
  message content; nothing yet polls `mlcukier+golfleague@gmail.com`. You
  mentioned an existing Gmail push/pull app on the same box — the cleanest
  path is to reuse its credentials and hand parsed messages to the parser.
  Tell me which library it uses and I'll wire it in.
- **Scheduler.** A cron that (a) fetches results after each event, (b) runs
  Hearn fallbacks at each tournament's start time, (c) sends the weekly digest
  and deadline reminders. The Hearn step is a single already-tested call.
- **Confirming the DataGolf earnings key** via `npm run verify:datagolf`.

## Assumptions

Flag anything that doesn't match how the league actually plays:

- **Quarters** split the season's events into 4 equal segments by count; when
  the count doesn't divide by 4, earlier quarters take the extra event.
- **Greller contributions** come from every roster participant each week,
  including anyone who forgot to pick.
- **TOCC ranking** uses weekly prize money — the same metric as the season race.
- **TOCC ties** (unspecified in the rules as given): a tie for 1st splits the
  collected stake evenly; a tie for 2nd means everyone tied there breaks even.
- **Side Pot 1 ties** that survive all three tiebreakers split the pot.
- **A participant with no valid Hearn pick** takes a zero for the week; they
  are never assigned a repeat golfer, and the admin UI flags the situation.
