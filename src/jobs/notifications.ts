import type { SendMail } from "../admin/server.js";
import { applyHearnFallbacks } from "../core/hearn.js";
import {
  findDueReminders,
  findDuePicksDigests,
  findDueTOCCPicksAnnouncements,
  findTournamentsNeedingHearnResolution,
  liveGrellerCandidateIds,
} from "../core/notifications.js";
import { renderPickReminderEmail, renderPicksDigestEmail, renderTOCCPicksAnnouncementEmail } from "../email/templates.js";
import {
  golferName,
  seasonPicks,
  seasonRoster,
  toccMemberIds,
  tournamentField,
  type LeagueData,
  type LeagueStore,
} from "../store/store.js";
import type { Participant, Season, Tournament } from "../types.js";

async function trySend(sendMail: SendMail, to: string, subject: string, bodyText: string, bodyHtml: string): Promise<void> {
  try {
    await sendMail({ to, subject, bodyText, bodyHtml });
  } catch (err) {
    console.error(`Failed to send "${subject}" to ${to}:`, err);
  }
}

/**
 * Sends and dedupe-records a single pick reminder. Exported so the admin
 * "Emails" tab's Send Now button can email every current non-picker on
 * demand, going through the exact same send+dedupe path as the automatic
 * sweep below rather than a separate copy of it.
 */
export async function sendPickReminderTo(
  store: LeagueStore,
  sendMail: SendMail,
  appUrl: string,
  tournament: Tournament,
  participant: Participant
): Promise<void> {
  const { subject, bodyText, bodyHtml } = renderPickReminderEmail(tournament.name, tournament.startTime, appUrl);
  await trySend(sendMail, participant.email, subject, bodyText, bodyHtml);
  await store.update((d) => {
    d.notifications.push({
      type: "PICK_REMINDER",
      tournamentId: tournament.id,
      participantId: participant.id,
      sentAt: new Date().toISOString(),
    });
  });
}

/** Everyone on the roster still without a pick for `tournament`, right now — ignores the automatic 24h window. Returns how many were emailed. */
export async function sendPickRemindersNow(
  store: LeagueStore,
  sendMail: SendMail,
  appUrl: string,
  data: LeagueData,
  season: Season,
  tournament: Tournament
): Promise<number> {
  const picked = new Set(
    seasonPicks(data, season.id).filter((p) => p.tournamentId === tournament.id).map((p) => p.participantId)
  );
  const targets = seasonRoster(data, season.id).filter((p) => !picked.has(p.id));
  for (const participant of targets) await sendPickReminderTo(store, sendMail, appUrl, tournament, participant);
  return targets.length;
}

/** The whole-roster picks digest for one tournament, right now. Returns the roster size (the recipient count, whether or not every address is real). */
export async function sendPicksDigestFor(
  store: LeagueStore,
  sendMail: SendMail,
  data: LeagueData,
  season: Season,
  tournament: Tournament
): Promise<number> {
  const roster = seasonRoster(data, season.id);
  const weekPicks = seasonPicks(data, season.id).filter((p) => p.tournamentId === tournament.id);
  const grellerIds = liveGrellerCandidateIds(weekPicks);

  const rows = roster.map((p) => {
    const pick = weekPicks.find((wp) => wp.participantId === p.id);
    return {
      name: p.nickname || p.name,
      golferName: pick ? golferName(data, pick.golferId) : null,
      source: pick?.source ?? null,
      isGrellerAlert: pick ? grellerIds.has(p.id) : false,
    };
  });
  const { subject, bodyText, bodyHtml } = renderPicksDigestEmail(tournament.name, rows);
  const recipients = roster.map((p) => p.email).join(", ");
  if (recipients) await trySend(sendMail, recipients, subject, bodyText, bodyHtml);
  await store.update((d) => {
    d.notifications.push({ type: "PICKS_DIGEST", tournamentId: tournament.id, sentAt: new Date().toISOString() });
  });
  return roster.length;
}

/** The TOCC-only picks announcement for one tournament, right now. Returns the TOCC roster size. */
export async function sendTOCCPicksAnnouncementFor(
  store: LeagueStore,
  sendMail: SendMail,
  data: LeagueData,
  season: Season,
  tournament: Tournament
): Promise<number> {
  const toccIds = toccMemberIds(data, season.id);
  const toccRoster = seasonRoster(data, season.id).filter((p) => toccIds.includes(p.id));
  const toccWeekPicks = seasonPicks(data, season.id).filter(
    (p) => p.tournamentId === tournament.id && toccIds.includes(p.participantId)
  );
  const soloIds = liveGrellerCandidateIds(toccWeekPicks);

  const rows = toccRoster.map((p) => {
    const pick = toccWeekPicks.find((wp) => wp.participantId === p.id);
    return {
      name: p.nickname || p.name,
      golferName: pick ? golferName(data, pick.golferId) : null,
      source: pick?.source ?? null,
      isSolo: pick ? soloIds.has(p.id) : false,
    };
  });
  const { subject, bodyText, bodyHtml } = renderTOCCPicksAnnouncementEmail(tournament.name, rows);
  const recipients = toccRoster.map((p) => p.email).join(", ");
  if (recipients) await trySend(sendMail, recipients, subject, bodyText, bodyHtml);
  await store.update((d) => {
    d.notifications.push({ type: "TOCC_PICKS_ANNOUNCEMENT", tournamentId: tournament.id, sentAt: new Date().toISOString() });
  });
  return toccRoster.length;
}

/**
 * Time-based half of the email notifications: pick reminders (24h before a
 * deadline, per non-picker), Hearn fallback resolution (right after a
 * deadline passes, for anyone still without a pick), and the post-deadline
 * picks digest (once per tournament, everyone's pick, tagged with "Greller
 * Alert!!" where nobody else picked that golfer). Meant to be called on a
 * recurring interval — see index.ts — so it's idempotent via the
 * notifications dedupe log (Hearn resolution needs no dedupe log of its own:
 * applyHearnFallbacks already skips anyone who already has a pick).
 *
 * Hearn resolution runs before the digest is built, deliberately — a
 * participant auto-assigned this sweep shows up in that same digest with
 * their real pick, not as "no pick yet".
 *
 * Also sends the TOCC-only picks announcement (findDueTOCCPicksAnnouncements)
 * right alongside the whole-roster digest — same timing, separate dedupe log,
 * separate (smaller) recipient list. The TOCC round-by-round standings
 * emails are NOT here — see jobs/toccLive.ts, which needs a live DataGolf
 * fetch per tick rather than a pure "what's due" check.
 *
 * The results digest (after a tournament's results are posted) isn't here —
 * it's event-driven, sent directly from the results-posting admin route.
 *
 * The actual send+dedupe logic for each of these lives in the exported
 * `send*` functions above, shared with the admin "Emails" tab's Send Now
 * buttons (admin/server.ts) so a manual send and an automatic one are
 * indistinguishable to a recipient — and both correctly stop the other from
 * duplicating, since both write the same dedupe record.
 */
export async function runNotificationSweep(store: LeagueStore, sendMail: SendMail, appUrl: string, now: Date = new Date()): Promise<void> {
  let data = await store.read();

  for (const { tournament, participant } of findDueReminders(data, now)) {
    await sendPickReminderTo(store, sendMail, appUrl, tournament, participant);
  }

  for (const { season, tournament } of findTournamentsNeedingHearnResolution(data, now)) {
    const result = applyHearnFallbacks({
      seasonId: season.id,
      tournamentId: tournament.id,
      participantIds: seasonRoster(data, season.id).map((p) => p.id),
      hearnLists: data.hearnPicks,
      existingPicks: data.picks,
      tournamentField: tournamentField(data, tournament.id),
      assignedAt: tournament.startTime,
    });
    if (result.picks.length > 0) {
      data = await store.update((d) => {
        d.picks.push(...result.picks);
      });
    }
  }

  for (const { season, tournament } of findDuePicksDigests(data, now)) {
    await sendPicksDigestFor(store, sendMail, data, season, tournament);
  }

  for (const { season, tournament } of findDueTOCCPicksAnnouncements(data, now)) {
    await sendTOCCPicksAnnouncementFor(store, sendMail, data, season, tournament);
  }
}
