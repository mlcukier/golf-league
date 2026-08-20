import type { SendMail } from "../admin/server.js";
import { buildSeasonReport } from "../core/report.js";
import { buildTOCCLiveStandings, estimateTOCCWeekFromLive } from "../core/toccLive.js";
import { fetchLiveInPlay, isRoundComplete, liveDataForTournament } from "../providers/dataGolfLive.js";
import { renderTOCCRoundUpdateEmail } from "../email/templates.js";
import { seasonPicks, seasonTournaments, toccMemberIds, type LeagueStore } from "../store/store.js";
import type { Season, Tournament } from "../types.js";

const FINAL_ROUND = 4;

/**
 * Only bother polling DataGolf's live feed for tournaments plausibly in
 * their Thursday-Sunday window — well past this, a tournament's regular
 * results digest has long since fired via the official-results path, so
 * there's nothing left for this job to do.
 */
const LIVE_WINDOW_MS = 6 * 24 * 60 * 60 * 1000;

/**
 * Sends the TOCC round-by-round standings emails: once per completed round
 * of play (Thursday-Sunday), TOCC members only, ordered by current standing.
 * The final (round 4) send additionally estimates this week's TOCC payouts
 * and the running season balance from live scoring — see
 * core/toccLive.ts's estimateTOCCWeekFromLive for why an estimate is
 * necessary (official earnings post days later).
 *
 * Unlike the rest of jobs/notifications.ts, "what's due" here can't be a
 * pure function of stored data alone — it depends on a live DataGolf fetch —
 * so this stays a separate sweep, called directly from index.ts alongside
 * the others, gated the same way (only when DATAGOLF_API_KEY is set).
 */
export async function runTOCCLiveSweep(
  store: LeagueStore,
  sendMail: SendMail,
  apiKey: string,
  tour: string = "pga",
  now: Date = new Date()
): Promise<void> {
  const data = await store.read();

  const candidates: { season: Season; tournament: Tournament; nextRound: number }[] = [];
  for (const season of data.seasons.filter((s) => s.status === "ACTIVE")) {
    if (toccMemberIds(data, season.id).length === 0) continue;
    for (const tournament of seasonTournaments(data, season.id)) {
      if (!tournament.externalEventId) continue;
      const msSince = now.getTime() - new Date(tournament.startTime).getTime();
      if (msSince < 0 || msSince > LIVE_WINDOW_MS) continue;
      const lastRound = data.notifications
        .filter((n) => n.type === "TOCC_ROUND_UPDATE" && n.tournamentId === tournament.id)
        .reduce((max, n) => Math.max(max, n.round ?? 0), 0);
      if (lastRound >= FINAL_ROUND) continue;
      candidates.push({ season, tournament, nextRound: lastRound + 1 });
    }
  }
  if (candidates.length === 0) return;

  let live;
  try {
    live = await fetchLiveInPlay(apiKey, tour);
  } catch (err) {
    console.error("DataGolf live in-play fetch failed:", err);
    return;
  }

  for (const { season, tournament, nextRound } of candidates) {
    const scoped = liveDataForTournament(live, tournament.name);
    if (!scoped || !isRoundComplete(scoped.rows, nextRound)) continue;

    const toccIds = toccMemberIds(data, season.id);
    const nameByParticipantId = new Map(data.participants.map((p) => [p.id, p.nickname || p.name]));
    const roster = data.participants.filter((p) => toccIds.includes(p.id));
    if (roster.length === 0) continue;

    const weekPicks = seasonPicks(data, season.id).filter((p) => p.tournamentId === tournament.id);
    const standings = buildTOCCLiveStandings(data, toccIds, weekPicks, scoped.rows);
    const rows = standings.map((s) => ({
      name: nameByParticipantId.get(s.participantId) ?? s.participantId,
      golferName: s.golferName,
      currentPos: s.currentPos,
      currentScore: s.currentScore,
    }));

    let money: { payments: { from: string; to: string; amount: number }[]; seasonNet: Record<string, number>; nameByParticipantId: Map<string, string> } | undefined;
    if (nextRound === FINAL_ROUND) {
      const weekResult = estimateTOCCWeekFromLive(data, toccIds, weekPicks, scoped.rows, tournament.id, {
        stake: season.toccStake,
        stakeIfWinner: season.toccStakeIfWinner,
      });
      // buildSeasonReport only counts tournaments with official results
      // posted, so this tournament (no official results yet) is naturally
      // excluded — exactly "prior weeks' net" to add this week's estimate on top of.
      const priorReport = buildSeasonReport(data, season);
      const seasonNet: Record<string, number> = { ...priorReport.tocc.netByParticipant };
      for (const payment of weekResult.payments) {
        seasonNet[payment.from] = (seasonNet[payment.from] ?? 0) - payment.amount;
        seasonNet[payment.to] = (seasonNet[payment.to] ?? 0) + payment.amount;
      }
      money = { payments: weekResult.payments, seasonNet, nameByParticipantId };
    }

    const { subject, bodyText, bodyHtml } = renderTOCCRoundUpdateEmail(tournament.name, nextRound, rows, money);
    const recipients = roster.map((p) => p.email).join(", ");
    try {
      await sendMail({ to: recipients, subject, bodyText, bodyHtml });
    } catch (err) {
      console.error(`Failed to send TOCC round update for ${tournament.name}:`, err);
    }
    await store.update((d) => {
      d.notifications.push({
        type: "TOCC_ROUND_UPDATE",
        tournamentId: tournament.id,
        round: nextRound,
        sentAt: new Date().toISOString(),
      });
    });
  }
}
