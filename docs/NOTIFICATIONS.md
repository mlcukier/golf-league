# Email notifications

Every email the app sends, in one place — this list kept getting rebuilt from
scratch each time someone added a notification, so here it is as its own
doc. See the main [README](../README.md) for everything else (rules, data
source, deployment).

Two channels, both outbound only today (see "Inbound email" below):

- **Scheduled** — decided by a recurring sweep (`setInterval` in
  `src/index.ts`, default every 15 min, `NOTIFICATION_SWEEP_MINUTES`). Each
  sweep tick is a fresh, idempotent pass: it recomputes "what's due right
  now" from the stored data (plus, for the TOCC round emails, one live
  DataGolf fetch) rather than tracking timers, so a missed tick, a restart,
  or a box that was off for a day all self-heal on the next tick instead of
  losing or duplicating an email.
- **Event-driven** — fired directly from the code path that caused it (right
  now, only the results digest, off `applyResults` in `src/admin/server.ts`),
  not from the sweep.

## The list

| Email | Subject | Trigger | Timing | Recipients | Dedupe |
| --- | --- | --- | --- | --- | --- |
| Password set/reset | "Set your golf league password" / "Reset your golf league password" | Admin adds a participant, or a "forgot password" request | Immediate | 1 participant | None — a new token/email replaces any prior unused one for that participant |
| Pick reminder | "Reminder: pick \<Tournament\> before it starts" | A roster member has no pick and the tournament's deadline is within 24h (`REMINDER_WINDOW_MS`) | Sweep | 1 non-picker per tournament | `notifications` log, type `PICK_REMINDER`, keyed on `tournamentId` + `participantId` |
| Picks digest | "Picks are in — \<Tournament\>" | Deadline just passed, within a 48h lookback (`DIGEST_LOOKBACK_MS`) | Sweep | Whole season roster, one email (all addresses in `To`) | `notifications` log, type `PICKS_DIGEST`, keyed on `tournamentId` |
| TOCC picks announcement | "TOCC Side Action Update" | Same window as the picks digest, TOCC members only; skipped entirely if the season has zero TOCC members | Sweep | TOCC roster only | `notifications` log, type `TOCC_PICKS_ANNOUNCEMENT`, keyed on `tournamentId` |
| Results digest | "Results — \<Tournament\>" | Results are (re)posted for a tournament — admin paste on the Results tab, or the DataGolf auto-pull sweep, both go through the same `applyResults` | Event-driven, immediate | Whole season roster, one email | None — deliberately resends on every re-post, so a corrected result sends a corrected digest |
| TOCC round update (rounds 1-3) | "TOCC Side Action Update" | A round of live play finishes (Thu/Fri/Sat) for a tournament within 6 days of its start, per DataGolf's live feed | Sweep (needs a live DataGolf fetch, see below) | TOCC roster only | `notifications` log, type `TOCC_ROUND_UPDATE`, keyed on `tournamentId` + `round` (1-4) |
| TOCC round update (round 4 / final) | "TOCC Side Action Update" | Same as above, round 4 | Sweep | TOCC roster only | Same, `round: 4` — additionally carries this week's estimated TOCC payments + running season balance |

All TOCC emails share one subject line (`TOCC_SUBJECT` in
`src/email/templates.ts`) so a mail client threads the whole week's picks
announcement + 4 round updates as one conversation.

Renderers live in `src/email/templates.ts`; every notification returns
`{ subject, bodyText, bodyHtml }` — plain text plus a shared branded HTML
shell (`emailShell`), sent multipart so it reads well in any client.

## Where each one is decided vs. sent

- `src/core/notifications.ts` — pure `findDue*` functions: given `LeagueData`
  and `now`, return what's due. No I/O, fully unit tested
  (`src/test/notifications.test.ts`). Covers reminders, Hearn resolution,
  the whole-roster picks digest, and the TOCC picks announcement.
- `src/jobs/notifications.ts` — `runNotificationSweep`: calls the `findDue*`
  functions above, actually sends mail, and writes the dedupe record. This
  is the only place that touches `sendMail` for the four notifications above.
  Order matters here: Hearn fallback resolution runs *before* the picks
  digest is built, so a participant auto-assigned this same tick shows up in
  the digest with their real pick instead of "no pick yet".
- `src/jobs/resultsPull.ts` — `runResultsPullSweep`: auto-pulls real
  DataGolf results ~4 days after a tournament starts
  (`COMPLETION_BUFFER_MS`) and calls `applyResults`, the same function the
  admin's manual paste route calls — so the results digest fires identically
  either way.
- `src/jobs/toccLive.ts` — `runTOCCLiveSweep`: the odd one out. "What's due"
  here isn't a pure function of stored data — it depends on a live DataGolf
  `/preds/in-play` fetch — so it's its own sweep function, called directly
  from `index.ts` alongside the others rather than folded into
  `runNotificationSweep`. Tracks the highest round already emailed per
  tournament (via `TOCC_ROUND_UPDATE` notification records' `round` field),
  fetches live standings once per tick, and sends the next round's email for
  any TOCC tournament whose next round just completed
  (`isRoundComplete` in `src/providers/dataGolfLive.ts`). If a tick is
  missed, `isRoundComplete`'s "no rows left at this round = field already
  moved past it" case lets a later tick catch up round-by-round instead of
  getting stuck waiting for a round that will never show as in-progress
  again.
- `src/admin/server.ts` — `sendResultsDigest` / `applyResults`: the one
  event-driven email, called straight from the results-posting route (and
  from `resultsPull.ts`), not from any sweep.

Both `dataGolfApiKey`-gated jobs (`resultsPull`, `toccLive`) are skipped
entirely when `DATAGOLF_API_KEY` isn't set — see `index.ts`.

## The dedupe mechanism

`LeagueData.notifications` (`src/store/store.ts`) is a flat, append-only log
of `NotificationRecord { type, tournamentId, participantId?, round?, sentAt }`
(`src/types.ts`). Every scheduled `findDue*` check is really "does a record
matching this key already exist?" — no separate scheduler state, no cron
library, no timers to leak across a restart. It only ever grows (nothing
prunes it), which is fine at this app's scale (a handful of tournaments and
participants per season) but would need attention if that ever changed.

Hearn fallback resolution is the one exception with *no* dedupe record: it
doesn't need one, because `applyHearnFallbacks` already skips any participant
who already has a pick, making a repeat call a no-op rather than a double
assignment.

## Adding a new scheduled notification

Follow `runTOCCLiveSweep` — the most recently added job, and the one that
needed the most machinery (live fetch + multi-step dedupe):

1. Add a new `NotificationType` in `src/types.ts` (and any extra field
   `NotificationRecord` needs, like TOCC's `round`).
2. Decide whether "what's due" is computable from stored data alone:
   - **Yes** — write a pure `findDueX(data, now)` in `src/core/notifications.ts`
     next to the existing ones, unit test it directly, and call it from
     `runNotificationSweep` in `src/jobs/notifications.ts`.
   - **No** (needs a live network call, like the TOCC live feed) — write a
     standalone `runXSweep(store, sendMail, ...)` in its own file under
     `src/jobs/`, and call it directly from `index.ts`'s `sweep()` closure,
     gated on whatever credential it needs.
3. Add a `renderXEmail(...)` in `src/email/templates.ts` returning
   `{ subject, bodyText, bodyHtml }`, using `emailShell`/`paragraphHtml`/
   `buttonHtml` for a consistent look.
4. After sending, push the matching `NotificationRecord` onto
   `data.notifications` via `store.update` — this is what makes the next
   sweep tick a no-op for the same trigger.
5. Test the pure logic directly (no store, no mocks); for a job file, test
   with `MemoryLeagueStore` and a fake `sendMail`/fetch, the same pattern
   `src/test/toccLive.test.ts` and `src/test/dataGolfLive.test.ts` use.

## Inbound email — built, not wired up

`src/email/commands.ts` (`executeCommand`) parses and answers
PICK/STANDINGS/POTS/MYPICKS/HELP as a pure function, and
`src/email/gmailClient.ts` has everything needed to poll a mailbox
(`listMessageIds`, `getMessage`, `sendThreadReply`, `ensureLabel`/`addLabel`/
`markRead`) — but as of this writing **nothing in `src/` calls those
inbound-mail functions**. The only caller of `executeCommand` is the web
route `POST /api/my/pick` (`src/admin/server.ts`), which builds a `PICK`
command straight from a JSON body, not from a parsed email. `PickSource`
(`src/types.ts`) only has `"web" | "admin" | "hearn"` — no `"email"` — which
is the tell.

In short: **participants pick via the web app today.** The reply-to-email
PICK flow is fully built and unit tested (`src/test/commands.test.ts`) but
dormant — wiring it up means writing a poller (list unread mail matching some
query, call `executeCommand`, `sendThreadReply` the result, `markRead`) and
calling it from the sweep, or a separate loop. If you're reading this because
"I thought you could pick by replying to an email" — that's the gap.

## Known limitations specific to the TOCC live-standings emails

- **Assumes exactly 4 rounds.** A weather-shortened 54-hole event never
  produces a round-4 completion, so the "final" email (with payments +
  season balance) never fires for that week. `FINAL_ROUND` is hardcoded in
  `src/jobs/toccLive.ts`.
- **Sunday's money is an estimate, not official.** `estimateTOCCWeekFromLive`
  (`src/core/toccLive.ts`) uses `-currentScore` as an earnings proxy to feed
  the real `computeTOCCWeek` engine, because official earnings don't post for
  ~4 days (`COMPLETION_BUFFER_MS` in `src/jobs/resultsPull.ts`) — too slow
  for a same-evening email. Known edge case: a golfer tied for the lead when
  regular play ends reads as the outright winner (`isWin: true`, doubling the
  TOCC stake) even if they go on to lose a playoff. The email labels these
  numbers "estimate — pending official results" but there's no follow-up
  correction email once the real results land; the admin dashboard's TOCC
  numbers become the source of truth at that point.
- **Assumes DataGolf drops cut players from the live feed rather than
  flagging them.** `fetchLiveInPlay`/`isRoundComplete` treat "player absent
  from `/preds/in-play`'s data" as "no data, sinks to the bottom of
  standings." This is inferred from one live sample taken during
  development (a completed FedEx St. Jude Championship snapshot, 69 rows,
  every `made_cut` probability at 1.0 — i.e. no cut players were left in the
  data to check the alternative against) — not verified against a full
  live tournament week where a real cut happened mid-feed. If DataGolf ever
  starts leaving cut players in with a stale round number instead, standings
  and `isRoundComplete` would both need a second look.
- **Name matching is normalized-string, not id-based.** `buildTOCCLiveStandings`
  and `estimateTOCCWeekFromLive` join the live feed to a pick by
  `normalizeGolferName` (lowercase, strip punctuation, sort words — see
  `src/store/store.ts`), because the live feed has no id in common with this
  app's golfer records. A name divergent enough to fail that normalization
  (a suffix, a nickname, a transliteration) would silently show as "no live
  data" for that golfer rather than erroring.
