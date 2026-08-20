import { seasonPicks, seasonRoster, seasonTournaments, toccMemberIds, type LeagueData } from "../store/store.js";
import type { Participant, Pick, Season, Tournament } from "../types.js";

/** How far ahead of a deadline a reminder is due. */
export const REMINDER_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * How far past a deadline a picks-digest is still worth sending. Bounds the
 * sweep so a box that's been offline (or a feature that just shipped) never
 * fires digests for tournaments whose deadline passed long ago — it just
 * quietly skips them instead of spamming stale mail.
 */
export const DIGEST_LOOKBACK_MS = 48 * 60 * 60 * 1000;

/** Active seasons across every league, test leagues included — a test league's roster gets the same emails, so it's usable as a live rehearsal. */
function activeSeasons(data: LeagueData): Season[] {
  return data.seasons.filter((s) => s.status === "ACTIVE");
}

export interface DueReminder {
  tournament: Tournament;
  participant: Participant;
}

/**
 * Roster members with no pick yet for a tournament inside the last
 * REMINDER_WINDOW_MS before its deadline, who haven't already been nudged
 * (per data.notifications).
 */
export function findDueReminders(data: LeagueData, now: Date): DueReminder[] {
  const due: DueReminder[] = [];
  for (const season of activeSeasons(data)) {
    for (const t of seasonTournaments(data, season.id)) {
      const msUntil = new Date(t.startTime).getTime() - now.getTime();
      if (msUntil <= 0 || msUntil > REMINDER_WINDOW_MS) continue;

      const picked = new Set(
        seasonPicks(data, season.id)
          .filter((p) => p.tournamentId === t.id)
          .map((p) => p.participantId)
      );
      for (const participant of seasonRoster(data, season.id)) {
        if (picked.has(participant.id)) continue;
        const alreadySent = data.notifications.some(
          (n) => n.type === "PICK_REMINDER" && n.tournamentId === t.id && n.participantId === participant.id
        );
        if (!alreadySent) due.push({ tournament: t, participant });
      }
    }
  }
  return due;
}

export interface DueHearnResolution {
  season: Season;
  tournament: Tournament;
}

/**
 * Tournaments whose deadline has passed, in any active season, where at
 * least one roster participant still has no pick. Unlike the digest, this
 * has no lookback bound and is re-checked every sweep — resolving is
 * idempotent (a participant who already has a pick is always skipped by
 * applyHearnFallbacks), and a participant should never be permanently stuck
 * pick-less just because a sweep tick was missed (a real bug this app has
 * hit before — see oneAndDone.ts's history).
 */
export function findTournamentsNeedingHearnResolution(data: LeagueData, now: Date): DueHearnResolution[] {
  const due: DueHearnResolution[] = [];
  for (const season of activeSeasons(data)) {
    for (const t of seasonTournaments(data, season.id)) {
      if (new Date(t.startTime).getTime() > now.getTime()) continue;
      const pickedIds = new Set(
        seasonPicks(data, season.id)
          .filter((p) => p.tournamentId === t.id)
          .map((p) => p.participantId)
      );
      if (seasonRoster(data, season.id).some((p) => !pickedIds.has(p.id))) due.push({ season, tournament: t });
    }
  }
  return due;
}

export interface DuePicksDigest {
  season: Season;
  tournament: Tournament;
}

/** Tournaments whose deadline just passed (within DIGEST_LOOKBACK_MS) with no digest sent yet. */
export function findDuePicksDigests(data: LeagueData, now: Date): DuePicksDigest[] {
  const due: DuePicksDigest[] = [];
  for (const season of activeSeasons(data)) {
    for (const t of seasonTournaments(data, season.id)) {
      const msSince = now.getTime() - new Date(t.startTime).getTime();
      if (msSince < 0 || msSince > DIGEST_LOOKBACK_MS) continue;
      const alreadySent = data.notifications.some((n) => n.type === "PICKS_DIGEST" && n.tournamentId === t.id);
      if (!alreadySent) due.push({ season, tournament: t });
    }
  }
  return due;
}

export interface DueTOCCPicksAnnouncement {
  season: Season;
  tournament: Tournament;
}

/**
 * TOCC-only counterpart to findDuePicksDigests — same timing window (right
 * after the deadline, within DIGEST_LOOKBACK_MS), but a separate dedupe type
 * so it fires alongside the whole-roster digest rather than colliding with
 * it. Skips seasons with no TOCC members at all, so this never queues up
 * digests nobody's on the roster to receive.
 */
export function findDueTOCCPicksAnnouncements(data: LeagueData, now: Date): DueTOCCPicksAnnouncement[] {
  const due: DueTOCCPicksAnnouncement[] = [];
  for (const season of activeSeasons(data)) {
    if (toccMemberIds(data, season.id).length === 0) continue;
    for (const t of seasonTournaments(data, season.id)) {
      const msSince = now.getTime() - new Date(t.startTime).getTime();
      if (msSince < 0 || msSince > DIGEST_LOOKBACK_MS) continue;
      const alreadySent = data.notifications.some(
        (n) => n.type === "TOCC_PICKS_ANNOUNCEMENT" && n.tournamentId === t.id
      );
      if (!alreadySent) due.push({ season, tournament: t });
    }
  }
  return due;
}

/**
 * Participant ids whose pick that week is the only one on that golfer — a
 * live shot at the Greller if the golfer goes on to win. Computed straight
 * from that week's picks, no results needed yet. Also reused, scoped down to
 * just the TOCC cohort's picks, to flag a "SOLO!" pick in the TOCC-only
 * picks announcement — same shape of question ("is this pick unique within
 * this group?"), just a different group.
 */
export function liveGrellerCandidateIds(weekPicks: Pick[]): Set<string> {
  const counts = new Map<string, number>();
  for (const p of weekPicks) counts.set(p.golferId, (counts.get(p.golferId) ?? 0) + 1);
  const ids = new Set<string>();
  for (const p of weekPicks) if (counts.get(p.golferId) === 1) ids.add(p.participantId);
  return ids;
}
