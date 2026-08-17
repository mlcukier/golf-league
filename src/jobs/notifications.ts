import type { SendMail } from "../admin/server.js";
import { applyHearnFallbacks } from "../core/hearn.js";
import {
  findDueReminders,
  findDuePicksDigests,
  findTournamentsNeedingHearnResolution,
  liveGrellerCandidateIds,
} from "../core/notifications.js";
import { renderPickReminderEmail, renderPicksDigestEmail } from "../email/templates.js";
import { golferName, seasonPicks, seasonRoster, tournamentField, type LeagueStore } from "../store/store.js";

async function trySend(sendMail: SendMail, to: string, subject: string, bodyText: string, bodyHtml: string): Promise<void> {
  try {
    await sendMail({ to, subject, bodyText, bodyHtml });
  } catch (err) {
    console.error(`Failed to send "${subject}" to ${to}:`, err);
  }
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
 * The results digest (after a tournament's results are posted) isn't here —
 * it's event-driven, sent directly from the results-posting admin route.
 */
export async function runNotificationSweep(store: LeagueStore, sendMail: SendMail, appUrl: string, now: Date = new Date()): Promise<void> {
  let data = await store.read();

  for (const { tournament, participant } of findDueReminders(data, now)) {
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
  }
}
