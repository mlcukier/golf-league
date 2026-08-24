import type { SendMail } from "../admin/server.js";
import { openTournament } from "../core/emailRouting.js";
import { renderFieldWithdrawalAdminEmail, renderFieldWithdrawalEmail } from "../email/templates.js";
import { fetchFieldUpdate, fieldForTournament } from "../providers/dataGolfField.js";
import { golferName, upsertGolfer, type LeagueData, type LeagueStore } from "../store/store.js";
import type { Tournament } from "../types.js";

/** "At least twice a day" per the admin ask — the field rarely changes faster than that, and this keeps DataGolf API usage light. */
const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;

async function trySend(sendMail: SendMail, to: string, subject: string, bodyText: string, bodyHtml: string): Promise<void> {
  try {
    await sendMail({ to, subject, bodyText, bodyHtml });
  } catch (err) {
    console.error(`Failed to send "${subject}" to ${to}:`, err);
  }
}

const withdrawalKey = (participantId: string, golferId: string) => `${participantId}:${golferId}`;

/**
 * Auto-pulls DataGolf's confirmed field for the currently-open tournament of
 * every active season, replacing the stored field outright — same trust
 * level as the admin's manual paste this supplements, see
 * `PUT /api/tournaments/:id/field`. Runs at most once per
 * CHECK_INTERVAL_MS per tournament (`Tournament.fieldLastCheckedAt`) rather
 * than every sweep tick, since DataGolf field-updates has nothing worth
 * polling every 15 minutes for.
 *
 * Every check diffs the new field against whatever was stored before to
 * catch a golfer dropping out. Any dropped golfer with an existing pick for
 * that tournament gets the affected participant (and every admin) an email;
 * each (tournament, participant, golfer) triple is only ever alerted once,
 * via the FIELD_WITHDRAWAL dedupe log.
 *
 * The very first time a tournament's field is ever stored (nothing to
 * compare against yet — including an admin's own prior manual paste, which
 * this job has never diffed before) is never treated as a mass withdrawal.
 * That does mean the *second* check after a hand-typed field could produce
 * false positives if the manual entry's names don't normalize-match
 * DataGolf's — see docs/NOTIFICATIONS.md.
 */
export async function runFieldUpdateSweep(
  store: LeagueStore,
  sendMail: SendMail,
  appUrl: string,
  apiKey: string,
  tour: string = "pga",
  now: Date = new Date(),
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  const data = await store.read();

  const candidates: Tournament[] = [];
  for (const season of data.seasons.filter((s) => s.status === "ACTIVE")) {
    const tournament = openTournament(data, season.id);
    if (!tournament || !tournament.externalEventId) continue;
    const lastChecked = tournament.fieldLastCheckedAt ? new Date(tournament.fieldLastCheckedAt).getTime() : 0;
    if (now.getTime() - lastChecked < CHECK_INTERVAL_MS) continue;
    candidates.push(tournament);
  }
  if (candidates.length === 0) return;

  let update;
  try {
    update = await fetchFieldUpdate(apiKey, tour, fetchImpl);
  } catch (err) {
    console.error("DataGolf field-updates fetch failed:", err);
    return;
  }

  const admins = data.participants.filter((p) => p.isAdmin);

  for (const tournament of candidates) {
    const golferNames = fieldForTournament(update, tournament.externalEventId);

    let previousIds = new Set<string>();
    let newIds = new Set<string>();
    const afterUpdate = await store.update((d) => {
      const t = d.tournaments.find((x) => x.id === tournament.id);
      if (t) t.fieldLastCheckedAt = now.toISOString();
      // Empty rows means DataGolf hasn't posted this event's field yet even
      // though the id matched — never clobber a real stored field with
      // emptiness, just retry next check.
      if (golferNames === null || golferNames.length === 0) return;
      previousIds = new Set(d.fields[tournament.id] ?? []);
      const ids = golferNames.map((n) => upsertGolfer(d, n).id);
      d.fields[tournament.id] = [...new Set(ids)];
      newIds = new Set(d.fields[tournament.id]);
    });

    if (golferNames === null || golferNames.length === 0) continue;
    if (previousIds.size === 0) continue; // nothing stored before this check — no baseline to diff against

    const removedIds = [...previousIds].filter((id) => !newIds.has(id));
    if (removedIds.length === 0) continue;

    const removedSet = new Set(removedIds);
    const affectedPicks = afterUpdate.picks.filter(
      (p) => p.tournamentId === tournament.id && removedSet.has(p.golferId)
    );
    if (affectedPicks.length === 0) continue;

    const alreadyNotified = new Set(
      afterUpdate.notifications
        .filter((n) => n.type === "FIELD_WITHDRAWAL" && n.tournamentId === tournament.id)
        .map((n) => withdrawalKey(n.participantId!, n.golferId!))
    );
    const newlyAffected = affectedPicks.filter((p) => !alreadyNotified.has(withdrawalKey(p.participantId, p.golferId)));
    if (newlyAffected.length === 0) continue;

    await sendFieldWithdrawalAlerts(store, sendMail, appUrl, afterUpdate, tournament, admins, newlyAffected, now);
  }
}

async function sendFieldWithdrawalAlerts(
  store: LeagueStore,
  sendMail: SendMail,
  appUrl: string,
  data: LeagueData,
  tournament: Tournament,
  admins: LeagueData["participants"],
  newlyAffected: LeagueData["picks"],
  now: Date
): Promise<void> {
  const deadlinePassed = now.getTime() >= new Date(tournament.startTime).getTime();
  const adminRows: { participantName: string; golferName: string }[] = [];

  for (const p of newlyAffected) {
    const participant = data.participants.find((x) => x.id === p.participantId);
    const gName = golferName(data, p.golferId);
    if (participant) {
      const { subject, bodyText, bodyHtml } = renderFieldWithdrawalEmail(
        gName,
        tournament.name,
        tournament.startTime,
        appUrl,
        deadlinePassed
      );
      await trySend(sendMail, participant.email, subject, bodyText, bodyHtml);
      adminRows.push({ participantName: participant.nickname || participant.name, golferName: gName });
    } else {
      console.error(`Field withdrawal alert: no participant record for ${p.participantId}`);
    }
    await store.update((d) => {
      d.notifications.push({
        type: "FIELD_WITHDRAWAL",
        tournamentId: tournament.id,
        participantId: p.participantId,
        golferId: p.golferId,
        sentAt: now.toISOString(),
      });
    });
  }

  if (adminRows.length > 0 && admins.length > 0) {
    const { subject, bodyText, bodyHtml } = renderFieldWithdrawalAdminEmail(
      tournament.name,
      adminRows,
      tournament.startTime,
      deadlinePassed
    );
    const recipients = admins.map((a) => a.email).join(", ");
    await trySend(sendMail, recipients, subject, bodyText, bodyHtml);
  }
}
