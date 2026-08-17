# Golf League App

Season-long "one and done" golf pool: each participant picks a different PGA
Tour golfer every week and earns that golfer's tournament winnings. The season
opens Jan 1 and closes with the second FedEx Cup playoff event. Tracks the
season race, four quarterly races, three side pots (Side Pot 1, the Greller,
TOCC), and Hearn-pick fallbacks — across multiple years and multiple leagues.

Everyone — participants and the admin alike — uses one web app: log in with
email + password, make your pick for the current tournament, manage your
Hearn fallback list, and check standings/pots. Admins get extra tabs for
schedule, results, and roster management. Email is used only for one-way
password-setup links today, and later (see "Still to build") for weekly
digests and deadline reminders.

## Quick start

```bash
npm install
npm test                 # 107 unit tests over the rule engine, auth, and routing
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

## Data source: DataGolf

**Confirmed against a live key: no prize-money field exists on this plan.**
The endpoint originally assumed from DataGolf's docs
(`historical-event-data/event-stats`) doesn't exist — it 404s. The real
per-event results endpoint is `historical-raw-data/rounds`, and its rows
carry detailed strokes-gained/round stats and a finish (`fin_text`), but no
earnings/money field of any kind. Schedule (`get-schedule`) and this week's
field (`field-updates`) work fine and are date/player data only, no money
involved either way.

`src/providers/dataGolfProvider.ts` still reads results through tolerant
extractors (`earnings`, `money`, `prize_money`, `purse_won`, `winnings`,
`payout`) in case a future endpoint or higher tier adds one — re-run the
classifier below if your plan ever changes:

```bash
DATAGOLF_API_KEY=xxxx npm run verify:datagolf
```

Zero dependencies, no build step. It pulls a completed event, prints every
field on the winner's row, and classifies them into money-like vs points-like
— then sanity-checks magnitude, since a PGA winner takes home $1-4M but scores
only ~500-750 FedEx points. The classifier itself is unit tested
(`src/test/verifyClassifier.test.ts`), including the `fedex_points_earned`
trap where a field name contains "earn" but is really points.

**Since earnings aren't available**, nothing is blocked: the admin
**Results** tab accepts pasted results (`Golfer, earnings, finish`) with no
API involved. Prize money is also printed on every tournament leaderboard, so
a weekly copy-paste is the real path for this league.

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
    tocc.ts                  TOCC subgroup side action
    report.ts                Composes all standings + pots into one view
    emailRouting.ts          Participant→season resolution + openTournament (the league-wide current week)
    auth.ts                  Password hashing, tokens, signed session cookies (pure, node:crypto only)
  providers/
    golfDataProvider.ts      Adapter interface
    dataGolfProvider.ts      DataGolf implementation (schedule, field, results)
    dataGolfOdds.ts          Live win-odds fetch + cache + event-match guard
    dataGolfPlayers.ts       Full PGA Tour roster fetch + cache, for Hearn Picks
    mockGolfDataProvider.ts  In-memory stand-in
  scripts/verify-datagolf.mjs  (repo root) Confirms money vs points on your plan
  store/
    store.ts                 LeagueData shape + season-scoped read helpers
    jsonStore.ts             Atomic JSON-file store (+ in-memory for tests)
  admin/
    server.ts                The whole HTTP API — public/auth/admin routes
    html.ts                  The single-page app (login, My Picks, admin tabs)
  email/
    commands.ts              Executes a PICK/STANDINGS/POTS/MYPICKS/HELP command against the store
    templates.ts             Reply/notification text (set-password email today; digests later)
    gmailClient.ts            Gmail API wrapper (reuses gmail-worker's OAuth token)
  test/                      128 tests
scripts/seed-admin.mjs       Bootstraps the first admin account, no server needed
scripts/seed-schedule.mjs    Pulls a season's schedule from DataGolf via the admin API
prisma/schema.prisma         Optional Postgres model (documented upgrade path)
```

`src/core/*` is pure and framework-free — no DB, no network — so every rule is
unit tested in isolation.

## Configuration

| Env var | Default | Purpose |
| --- | --- | --- |
| `LEAGUE_DB` | `./data/league.json` | League database file |
| `ADMIN_PORT` | `8080` | HTTP port |
| `ADMIN_HOST` | `0.0.0.0` | Bind address (LAN/internet-visible by default) |
| `SESSION_SECRET` | *(random, regenerated each restart)* | Signs session cookies — set a fixed one in production, or every restart logs everyone out |
| `GMAIL_STATE_DIR` | *(unset — emails are logged, not sent)* | Where the shared `google-oauth.json`/`google-token.json` live; see below |
| `DATAGOLF_API_KEY` | *(unset — pickers show names with no odds)* | Used by the verify script, the schedule/field seed script, and live win odds in the pick/Hearn pickers |
| `NODE_ENV` | — | Set to `production` to mark session cookies `Secure` (requires HTTPS) |

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

## Still to build

The rule engine, store, and the combined participant/admin web app are done
and tested end to end. What remains needs credentials or a decision from you:

- **Scheduler.** A cron that (a) fetches results after each event — since
  DataGolf has no money, this means posting the admin-pasted results, not an
  API pull, (b) runs Hearn fallbacks at each tournament's start time, (c)
  sends the weekly digest and deadline-reminder emails. The Hearn step is a
  single already-tested call; `src/email/templates.ts` already has
  `renderStandings`/`renderPots` ready to become digest content, and
  `gmailClient.sendEmail` is the same function the password-setup emails use.
- **Deploying to a public host.** Runs locally today; moving to a small
  cloud VPS/PaaS needs a domain, HTTPS, and a decision on whether the JSON
  file store survives as-is (needs a persistent volume, not ephemeral
  storage) or gets swapped for the Prisma/Postgres schema that's already
  sketched out in `prisma/schema.prisma`.

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
