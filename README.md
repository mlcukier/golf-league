# Golf League App

Season-long "one and done" golf pool: each participant picks a different PGA
Tour golfer every week and earns that golfer's tournament winnings. The season
opens Jan 1 and closes with the second FedEx Cup playoff event. Tracks the
season race, four quarterly races, three side pots (Side Pot, the Greller,
TOCC), and Hearn-pick fallbacks — across multiple years and multiple leagues.

Everyone — participants and the admin alike — uses one web app: log in with
email + password, make your pick for the current tournament, manage your
Hearn fallback list, and check standings/pots. Admins get extra tabs for
schedule, results, and roster management.

Email today is **outbound only**: password-setup links, pick reminders, the
post-deadline picks digest, the results digest, and (new) a TOCC-only
"TOCC Side Action Update" thread with live round-by-round standings during
a tournament. A background sweep (`setInterval`, no cron library) decides
what's due every 15 minutes; some of it (results, TOCC live standings) also
comes from DataGolf's API. **See [docs/NOTIFICATIONS.md](docs/NOTIFICATIONS.md)
for the full list of what gets sent, when, to whom, and how — that's the doc
to update whenever a new notification is added, so this doesn't have to get
re-derived from the code again.** Replying to an email to make a pick
(PICK/STANDINGS/POTS/MYPICKS/HELP) is built and unit tested
(`src/email/commands.ts`) but not wired to a live inbox poller yet — see that
doc's "Inbound email" section.

## Quick start

```bash
npm install
npm test                 # ~210 unit tests: rule engine, auth, providers, email, store
npm run build
LEAGUE_DB=./data/league.json ADMIN_PORT=8080 SESSION_SECRET=pick-a-secret npm start
```

There's a chicken-and-egg problem bootstrapping the first admin: creating and
promoting a participant both require already being logged in as one. Solve it
once, without a running server:

```bash
LEAGUE_DB=./data/league.json node scripts/seed-admin.mjs you@example.com 'temporary-password' "Your Name"
```

Then open `http://<your-box>:8080/` from any device, log in, and use the
*Roster* tab to add everyone else — each gets emailed a link to set their own
password. The page has no build step and works on a phone.

## League rules as implemented

| Rule | Behavior |
| --- | --- |
| **One and done** | Each participant may use each golfer at most once **per season**. The pool resets each year. |
| **Weekly scoring** | Points = the selected golfer's prize money that week. |
| **Pick deadline** | A pick must be **submitted strictly before the tournament's start time**. At/after the start is rejected. |
| **Season winner** | Highest total earnings across the season. |
| **Quarterly winners** | The season's tournaments split into **4 equal segments by event count**; highest earnings in each. |
| **Side Pot** | Funded by $50 per missed cut. Won by the participant whose picks produced the most top-10s; ties break on top-5s, then wins. |
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

## TOCC side action

A separate, opt-in wager among a subset of the roster — "TOCC members" are
flagged per season per participant (`SeasonEntry.isTOCCMember`,
`toccMemberIds` in `src/store/store.ts`), so membership can change year to
year without touching the main roster or one-and-done pool. Ranked weekly by
the same metric as the season race (prize money from each member's normal
weekly pick — there's no separate TOCC-only pick).

**The money rules — stakes, doubling on an outright win, the 2nd-place
break, tie handling — are fully specified in `src/core/tocc.ts`'s doc
comment**, not repeated here; read that alongside `src/test/tocc.test.ts`,
which pins every case in the doc comment (solo win, tied win, solo 2nd,
tied 2nd, doubled stake, all-zero week) — the two together are the actual
spec, more trustworthy than any prose summary including this one. Defaults
are $100/loser/week, doubling to $200 if the winning pick also won the real
tournament (`DEFAULT_TOCC_STAKE`/`DEFAULT_TOCC_STAKE_IF_WINNER`); each season
can override both (`Season.toccStake`/`toccStakeIfWinner`).

**New this year: a live-standings email thread during the tournament itself**,
not just the after-the-fact weekly settlement. TOCC members only get a
"TOCC Side Action Update" email once each round of live play wraps up
(Thu/Fri/Sat/Sun), pulled from DataGolf's `/preds/in-play` feed, with the
Sunday send additionally estimating that week's TOCC payouts and the running
season balance ahead of official results (which take ~4 days to post). Full
trigger/timing/recipient details, and the known edge cases in that estimate,
are in [docs/NOTIFICATIONS.md](docs/NOTIFICATIONS.md). The code:
`src/providers/dataGolfLive.ts` (the live feed fetch + safety guards),
`src/core/toccLive.ts` (matches picks to live standings, estimates a week's
payout by feeding synthetic results into the real `computeTOCCWeek`), and
`src/jobs/toccLive.ts` (the sweep that decides when a round's email is due).

## Data source: DataGolf

This app treats DataGolf's API docs as a starting hypothesis, not ground
truth — every endpoint below was confirmed against a live key before being
relied on, and the doc comment next to each provider function says what was
actually tried, including the dead ends. That pattern matters more than any
individual endpoint here: DataGolf's plans/docs change, so if something in
this table stops matching reality, re-verify against a live key rather than
trusting either this doc or their docs.

| Endpoint | Used for | Notes |
| --- | --- | --- |
| `get-schedule` | Season schedule (`scripts/seed-schedule.mjs`) | Date/player data only, no money involved |
| `field-updates` | This week's confirmed field | Same |
| `historical-event-data/events?tour=&event_id=&year=` | **Real results** — auto-pulled ~4 days after a tournament starts by `src/jobs/resultsPull.ts` | Two endpoints were tried and ruled out first: `historical-event-data/event-stats` (assumed from docs alone) doesn't exist — it 404s; `historical-raw-data/rounds` is real but carries only strokes-gained/round stats and a finish, no money. `event_stats` rows on *this* endpoint carry `earnings`, `fin_text`, and `fec_points` (FedExCup points) per player, and post fast — the 2026 FedEx St. Jude Championship's real results (Scheffler's $3.6M win included) were live on the API the day after the event finished |
| `preds/pre-tournament` | Live win odds shown next to each golfer in the pick/Hearn pickers | No way to request a *specific* future event — only whichever one DataGolf currently has predictions for, which can lag the actual upcoming tournament by days. `oddsForTournament` (`src/providers/dataGolfOdds.ts`) only attaches odds when the response's `event_name` matches the tournament being priced; otherwise odds are shown as unavailable rather than risking the wrong week's numbers |
| `preds/get-dg-rankings` (filtered to `primary_tour: "PGA"`) | Full ~188-player PGA Tour roster, for the season-long Hearn fallback list | `get-player-list` (used for the weekly field) has no tour filter and returns ~3,500 players across every tour DataGolf tracks worldwide — too broad for a fallback list |
| `preds/in-play` | **NEW** — live, updating leaderboard feed (round/thru/position/score) during an active tournament, ~5 min refresh, that drives the TOCC round-by-round standings emails | Same "must check the response's event name" safety rule as odds above — see `liveDataForTournament` in `src/providers/dataGolfLive.ts`. See "TOCC side action" above and `docs/NOTIFICATIONS.md` |
| (recent-form/course-history endpoints) | Recent-form and course-history sections on the pick page | `src/providers/dataGolfForm.ts` |

`src/providers/dataGolfProvider.ts` reads results through tolerant
extractors (`earnings`, `money`, `prize_money`, `purse_won`, `winnings`,
`payout`) in case a field ever gets renamed — re-run the classifier below to
double-check on any plan:

```bash
DATAGOLF_API_KEY=xxxx npm run verify:datagolf
```

Zero dependencies, no build step. It pulls a completed event, prints every
field on the winner's row, and classifies them into money-like vs points-like
— then sanity-checks magnitude, since a PGA winner takes home $1-4M but scores
only ~500-750 FedEx points. The classifier itself is unit tested
(`src/test/verifyClassifier.test.ts`), including the `fedex_points_earned`
trap where a field name contains "earn" but is really points.

Results are auto-pulled once a tournament started at least ~4 days ago and
has no results yet (`COMPLETION_BUFFER_MS`, `src/jobs/resultsPull.ts`,
requires `DATAGOLF_API_KEY`) — going through the exact same `applyResults`
function the admin **Results** tab's manual paste uses, so the results digest
email fires identically either way. Manual paste (`Golfer, earnings, finish`)
remains available as a backfill/correction path and is never overwritten by
the auto-pull once results exist for a tournament.

### Seeding the schedule and field from DataGolf

`scripts/seed-schedule.mjs` pulls the season schedule via the app's own admin
API — every tournament goes through the same validation as typing it in by
hand — and tries to spot the 2nd FedEx Cup playoff event (BMW Championship)
to mark as the season finale and stop there, since nothing else truncates an
admin-entered schedule at the finale automatically
(`core/season.ts`'s `selectSeasonTournaments` has that logic, but only the
DataGolf provider's `getSeasonSchedule` path calls it — not admin-entered
tournaments):

```bash
DATAGOLF_API_KEY=xxxx GOLF_APP_EMAIL=you@example.com GOLF_APP_PASSWORD=xxx \
  node scripts/seed-schedule.mjs <seasonId> <year>
```

Defaults to events DataGolf still marks "upcoming" — already-played events
have no pick to make and would sit there with no results forever, which (per
`core/emailRouting.ts`) blocks every participant's pick target until someone
backfills real results. Set `DATAGOLF_INCLUDE_COMPLETED=1` to seed the whole
year anyway. Pick deadlines default to 10:00 UTC on each start date (DataGolf
gives no tee time) — adjust in the Schedule tab if precision matters. Set the
field for a tournament the same way, straight from `field-updates`, via the
admin `PUT /api/tournaments/:id/field` route.

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
    tocc.ts                  TOCC subgroup side action — money-rules spec lives in this file's doc comment
    toccLive.ts               Matches TOCC picks to DataGolf's live leaderboard; estimates a week's TOCC payout pre-results
    report.ts                Composes all standings + pots into one view (buildSeasonReport — single source of truth for dashboard/email/digests)
    notifications.ts         Pure "what's due" queries for the scheduled emails — see docs/NOTIFICATIONS.md
    emailRouting.ts          Participant→season resolution + openTournament (the league-wide current week)
    auth.ts                  Password hashing, tokens, signed session cookies (pure, node:crypto only)
  providers/
    golfDataProvider.ts      Adapter interface
    dataGolfProvider.ts      DataGolf implementation (schedule, field, results)
    dataGolfOdds.ts          Live win-odds fetch + cache + event-match guard
    dataGolfPlayers.ts       Full PGA Tour roster fetch + cache, for Hearn Picks
    dataGolfForm.ts          Recent-form + course-history fetch + cache, for the pick page
    dataGolfLive.ts          Live in-play leaderboard feed + event-match guard + round-complete check
    mockGolfDataProvider.ts  In-memory stand-in
  jobs/
    notifications.ts         runNotificationSweep — reminders, Hearn resolution, picks digest, TOCC picks announcement
    resultsPull.ts           runResultsPullSweep — auto-pulls real DataGolf results ~4 days after a tournament starts
    toccLive.ts              runTOCCLiveSweep — TOCC round-by-round live standings emails (needs a live fetch, so it's not in notifications.ts)
  scripts/verify-datagolf.mjs  (repo root) Confirms money vs points on your plan
  store/
    store.ts                 LeagueData shape + season-scoped read helpers
    jsonStore.ts             Atomic JSON-file store (+ in-memory for tests)
  admin/
    server.ts                The whole HTTP API — public/auth/admin routes
    html.ts                  The single-page app (login, My Picks, admin tabs)
  email/
    commands.ts              Executes a PICK/STANDINGS/POTS/MYPICKS/HELP command against the store (built, not yet wired to inbound mail — see docs/NOTIFICATIONS.md)
    templates.ts             Every outbound email's subject/text/HTML — see docs/NOTIFICATIONS.md for the full list
    gmailClient.ts           Gmail API wrapper (reuses gmail-worker's OAuth token); has inbound list/get functions too, currently unused
  test/                      ~210 tests — living spec for every core rule; see "Tests as documentation" below
scripts/seed-admin.mjs       Bootstraps the first admin account, no server needed
scripts/seed-schedule.mjs    Pulls a season's schedule from DataGolf via the admin API
scripts/seed-history.mjs     Fills a (test-flagged) season with plausible random history, for exercising every rule/pot end to end
prisma/schema.prisma         Optional Postgres model (documented upgrade path)
```

`src/core/*` is pure and framework-free — no DB, no network — so every rule is
unit tested in isolation.

### Tests as documentation

For any core rule, the module's doc comment plus its test file together *are*
the spec — more trustworthy than any prose summary, including this README.
The canonical example: `src/core/tocc.ts`'s doc comment lays out every TOCC
tie/stake case in prose, and `src/test/tocc.test.ts` pins each one with a
concrete example. Same pattern elsewhere: `src/providers/dataGolfLive.ts` +
`src/test/dataGolfLive.test.ts` for the live-feed parsing and
round-completion logic, `src/core/oneAndDone.ts` + `src/test/oneAndDone.test.ts`
for why one-and-done has no override path. When in doubt about what a rule
*actually* does, read the test file before trusting a comment (including this
one) — comments rot, tests fail loudly when they do.

## Configuration

| Env var | Default | Purpose |
| --- | --- | --- |
| `LEAGUE_DB` | `./data/league.json` | League database file |
| `ADMIN_PORT` | `8080` | HTTP port |
| `ADMIN_HOST` | `0.0.0.0` | Bind address (LAN/internet-visible by default) |
| `SESSION_SECRET` | *(random, regenerated each restart)* | Signs session cookies — set a fixed one in production, or every restart logs everyone out |
| `GMAIL_STATE_DIR` | *(unset — emails are logged, not sent)* | Where the shared `google-oauth.json`/`google-token.json` live; see below |
| `DATAGOLF_API_KEY` | *(unset — pickers show names with no odds, and the results-pull/TOCC-live sweeps don't run at all)* | Used by the verify script, the schedule/field seed script, live win odds, recent-form, the results auto-pull sweep, and the TOCC live-standings sweep |
| `APP_BASE_URL` | `http://localhost:<ADMIN_PORT>` | Base URL used in links inside notification emails (pick reminders, password links). Set to your LAN/public address in production — the app logs a warning at startup if unset |
| `NOTIFICATION_SWEEP_MINUTES` | `15` | How often the background sweep runs (reminders, digests, results pull, TOCC live standings) — see `src/index.ts` and [docs/NOTIFICATIONS.md](docs/NOTIFICATIONS.md) |
| `NODE_ENV` | — | Set to `production` to mark session cookies `Secure` (requires HTTPS) |

`scripts/seed-schedule.mjs` also reads `DATAGOLF_TOUR` (default `pga`),
`GOLF_APP_URL`, `GOLF_APP_EMAIL`, `GOLF_APP_PASSWORD`, and
`DATAGOLF_INCLUDE_COMPLETED` — script-only, not read by the running app.

## Auth

One account system for everyone: a `Participant` is just flagged `isAdmin`
to unlock the admin tabs, instead of the old separate `ADMIN_TOKEN` link.

- **Login** is email + password. Passwords are hashed with `scrypt`
  (`src/core/auth.ts`, `node:crypto` only — no new dependency).
- **Sessions** are a signed, stateless cookie (HMAC-SHA256) — no server-side
  session table. The cookie embeds the participant's `passwordSetAt`, so
  changing your password invalidates every other active session without
  needing one.
- **Setting a password** happens by email: adding a participant (or "forgot
  password") emails them a one-time link (1 hour expiry) via
  `src/email/gmailClient.ts`, which reuses the OAuth client + refresh token
  already authorized by the `gmail-worker` app at `~/.clawdbot-gmail-worker`
  — no separate Google Cloud setup, as long as `GMAIL_STATE_DIR` points at
  it. Without it, links are logged to the console instead of emailed (handy
  for local dev).
- **Bootstrapping the first admin** — see Quick start above,
  `scripts/seed-admin.mjs`.

Known, deliberate gaps: no login rate-limiting, and CSRF protection relies on
`SameSite=Lax` cookies rather than a separate token — both fine at this app's
scale, worth revisiting if that changes.

## Picks and Hearn Picks

`openTournament` (`src/core/emailRouting.ts`) decides which tournament is
currently open, league-wide: the earliest one in a season with no posted
results yet. Deliberately clock- and participant-independent — a tournament
only closes once its results are in, not once its deadline passes, and it's
the same "current" week for everyone rather than tracked per participant.
Two things that fell out of that:

- **Changing a pick** just works: `POST /api/my/pick` always takes an
  explicit `tournamentId` and replaces any existing pick for that week
  (excluded from the one-and-done check before validating, same as the
  admin override path) rather than rejecting a resubmit. `validatePick`
  still enforces the real deadline against the tournament actually named, so
  a stale page can't sneak a late pick through.
- A participant who misses a week with no valid Hearn fallback (see
  `hearn.ts` — it never invents a pick) doesn't get stuck: once that week's
  results are posted, `openTournament` moves on for everyone regardless of
  whether they ever had a pick recorded for it.

Both the weekly pick (**My Picks** tab) and the season-long fallback list
(**Hearn Picks** tab) are `<select>` dropdowns, not free text — no more
misspelled golfer names. They're deliberately sourced differently, though:

- The **weekly pick** is scoped to the open tournament's actual confirmed
  field — you can only pick someone playing that week.
- **Hearn Picks** draws from the whole PGA Tour roster
  (`src/providers/dataGolfPlayers.ts`, `preds/get-dg-rankings` filtered to
  `primary_tour: "PGA"` — 188 real tour players, not the ~50 in any one
  week's field and not the ~3,500 across every tour DataGolf tracks
  worldwide). It's a fallback that can be called on for *any* future week,
  so scoping it to this week's field would make most of the tour
  unselectable for no reason.

Either way, an existing Hearn entry (or pick) whose golfer has since dropped
out of the relevant pool stays selectable in its dropdown instead of quietly
disappearing on the next save.

Each option shows DataGolf's live win odds when available via
`src/providers/dataGolfOdds.ts`, which caches `preds/pre-tournament` for 10
minutes and — since that endpoint has no way to request a *specific* future
event, only whichever one DataGolf currently has predictions for, and that
can lag the actual upcoming tournament by several days — only attaches odds
when the response's event name matches the tournament being priced.
Otherwise odds just show as unavailable rather than risk showing the wrong
week's numbers; they appear automatically once DataGolf catches up, no
redeploy needed. Odds naturally only show up for Hearn options that also
happen to be in the current field, since that's the only event odds exist
for.

Admin-only nav tabs get a distinct (violet) color so the admin and
self-service areas of the page always read as separate zones.

## Scheduling

One `setInterval` loop in `src/index.ts` — no cron library, no separate
worker process. Every `NOTIFICATION_SWEEP_MINUTES` (default 15) it fires a
`sweep()` closure that runs a handful of independent, idempotent "sweep"
functions:

- `runNotificationSweep` (`src/jobs/notifications.ts`) — always runs.
  Reminders, Hearn fallback resolution, the picks digest, the TOCC picks
  announcement.
- `runResultsPullSweep` (`src/jobs/resultsPull.ts`) and `runTOCCLiveSweep`
  (`src/jobs/toccLive.ts`) — only run when `DATAGOLF_API_KEY` is set, since
  both need a live DataGolf call.

Each is idempotent and self-healing by design: they recompute "what's due"
from stored data (`data.notifications` as a dedupe log, see below) every
tick rather than tracking their own timers, so a restart, a missed tick, or
a box that was down for a day never double-sends or permanently skips
anything — it just catches up on the next tick. **Full notification-by-
notification detail — subjects, triggers, recipients, dedupe keys, and how to
add a new one — lives in [docs/NOTIFICATIONS.md](docs/NOTIFICATIONS.md)**,
which also covers the one event-driven (non-sweep) email, the results
digest.

The results-posting path (`applyResults` in `src/admin/server.ts`) is the one
notification NOT driven by the sweep — it fires directly from whatever
posted results, admin paste or the auto-pull sweep, so it's never delayed by
the sweep interval.

## Deployment

Runs today on a small DigitalOcean droplet as a systemd service
(`golf-league.service`) behind Caddy for HTTPS, at `toccgl.com`. The JSON
file store (`LEAGUE_DB`) lives on the box's own disk — fine at this scale,
but means the data directory needs to be part of any backup, and doesn't
survive a PaaS with ephemeral storage. Deploy is a build + rsync + restart,
not a CI pipeline:

```bash
npm run build
rsync -az --delete dist/ <deploy-user>@<host>:~/golf-league/dist/
ssh <deploy-user>@<host> "sudo systemctl restart golf-league"
```

(Host/user/key for this app's actual production box are kept in local
operator notes, not in this repo, since this repo's remote isn't
confirmed-private.)

`data/`, `node_modules/`, and everything else needed to run live outside
`dist/` on the box already, matching the local repo layout — only `dist/`
gets synced on a normal deploy. If the Prisma/Postgres schema
(`prisma/schema.prisma`) is ever adopted in place of the JSON store, this
section needs revisiting (managed Postgres vs. a DB on the same box, backup
strategy, migrations as part of deploy).

## Known limitations

- **Inbound email (reply-to-pick) is built but not wired up.** See
  [docs/NOTIFICATIONS.md](docs/NOTIFICATIONS.md#inbound-email--built-not-wired-up) —
  participants pick via the web app today; the PICK/STANDINGS/POTS/MYPICKS/HELP
  command parser and the Gmail inbox-polling primitives both exist and are
  tested, but nothing calls them together yet.
- **TOCC live-standings assumes exactly 4 rounds.** A weather-shortened
  54-hole event never fires the "final" round email (with payments + season
  balance) — see `docs/NOTIFICATIONS.md`.
- **TOCC Sunday money is a live estimate, not official**, until the real
  results-pull job posts real earnings ~4 days later; one known edge case
  (a golfer tied for the lead reading as an outright win) is documented in
  `src/core/toccLive.ts`.
- **The live-feed "cut players just vanish" assumption is inferred from one
  sample**, not exhaustively verified across a full tournament week — see
  `docs/NOTIFICATIONS.md`.
- **`data.notifications` (the dedupe log) only ever grows** — nothing prunes
  old records. Harmless at this app's scale (a season's worth of
  tournaments/participants), worth revisiting if that changes.
- **No login rate-limiting**, and CSRF protection relies on `SameSite=Lax`
  cookies rather than a separate token (see "Auth" above) — both fine at
  this app's scale.
- **The JSON file store is a single point of failure** and isn't safe for
  multiple app instances writing concurrently (writes are serialized within
  one process via a promise chain, not across processes) — fine for one
  always-on box, would need the Postgres path first for anything else.

## Assumptions

Flag anything that doesn't match how the league actually plays:

- **Quarters** split the season's events into 4 equal segments by count; when
  the count doesn't divide by 4, earlier quarters take the extra event.
- **Greller contributions** come from every roster participant each week,
  including anyone who forgot to pick.
- **TOCC ranking** uses weekly prize money — the same metric as the season race.
- **TOCC ties** (unspecified in the rules as given): a tie for 1st splits the
  collected stake evenly; a tie for 2nd means everyone tied there breaks even.
- **Side Pot ties** that survive all three tiebreakers split the pot.
- **A participant with no valid Hearn pick** takes a zero for the week; they
  are never assigned a repeat golfer, and the admin UI flags the situation.
