import { parseFinishPosition } from "../providers/dataGolfProvider.js";
import type { LiveInPlayRow } from "../providers/dataGolfLive.js";
import { golferName, normalizeGolferName, type LeagueData } from "../store/store.js";
import type { GolferResult, Pick } from "../types.js";
import { computeTOCCWeek, type TOCCStakes, type TOCCWeekResult } from "./tocc.js";

export interface TOCCLiveStandingRow {
  participantId: string;
  /** Null when the participant has no pick at all for this tournament. */
  golferName: string | null;
  /** Raw DataGolf finish text ("1", "T3", "CUT", "WD"); null when there's no live row for this golfer (name mismatch or not yet started). */
  currentPos: string | null;
  currentScore: number | null;
}

/**
 * One row per TOCC participant, their pick's live standing, sorted best
 * first (lower relative score wins; no live data or a cut/withdrawal sinks
 * to the bottom, same convention the rest of the app uses for a $0 week).
 * Matches picks to live rows by normalized name, the same "Last, First" vs
 * "First Last" tolerance store.ts's findGolferByName applies elsewhere —
 * inlined here since the live feed has no golfer id of ours to join on.
 */
export function buildTOCCLiveStandings(
  data: LeagueData,
  toccParticipantIds: string[],
  weekPicks: Pick[],
  liveRows: LiveInPlayRow[]
): TOCCLiveStandingRow[] {
  const liveByName = new Map(liveRows.map((r) => [normalizeGolferName(r.playerName), r]));

  const rows: TOCCLiveStandingRow[] = toccParticipantIds.map((participantId) => {
    const pick = weekPicks.find((p) => p.participantId === participantId);
    if (!pick) return { participantId, golferName: null, currentPos: null, currentScore: null };
    const name = golferName(data, pick.golferId);
    const live = liveByName.get(normalizeGolferName(name));
    return {
      participantId,
      golferName: name,
      currentPos: live?.currentPos ?? null,
      currentScore: live?.currentScore ?? null,
    };
  });

  return rows.sort((a, b) => {
    const aKey = a.currentScore ?? Number.POSITIVE_INFINITY;
    const bKey = b.currentScore ?? Number.POSITIVE_INFINITY;
    if (aKey !== bKey) return aKey - bKey;
    return (a.golferName ?? "").localeCompare(b.golferName ?? "");
  });
}

/**
 * A picked golfer with no live row at all (name mismatch, or simply out of
 * the event) is treated the same as a real $0 week: worst possible rank,
 * never mistaken for a leader. Finite (not -Infinity) so the sort/tie math
 * in computeTOCCWeek never divides Infinity by Infinity into NaN.
 */
const NO_LIVE_DATA_EARNINGS = -1_000_000;

/**
 * Estimates this week's TOCC payments from DataGolf's live leaderboard
 * instead of official results — official earnings don't post for days after
 * the event (see jobs/resultsPull.ts's COMPLETION_BUFFER_MS), too late for a
 * same-evening Sunday email. Relative score is a safe stand-in for ranking
 * purposes: within one event, a better finish never earns less than a worse
 * one, and the TOCC stake amounts don't depend on the tournament's actual
 * purse — only on relative order and who (if anyone) is the outright winner.
 * The one real gap: a golfer tied for the lead when the field finishes
 * regular play reads as `isWin` here even if they go on to lose a playoff —
 * callers should label this an estimate, pending the official results digest.
 */
export function estimateTOCCWeekFromLive(
  data: LeagueData,
  toccParticipantIds: string[],
  weekPicks: Pick[],
  liveRows: LiveInPlayRow[],
  tournamentId: string,
  stakes: TOCCStakes
): TOCCWeekResult {
  const liveByName = new Map(liveRows.map((r) => [normalizeGolferName(r.playerName), r]));
  const pickedGolferIds = new Set(
    weekPicks.filter((p) => toccParticipantIds.includes(p.participantId)).map((p) => p.golferId)
  );

  const syntheticResults: GolferResult[] = [...pickedGolferIds].map((golferId) => {
    const live = liveByName.get(normalizeGolferName(golferName(data, golferId)));
    const finishPosition = live ? parseFinishPosition(live.currentPos) : null;
    const earnings = live?.currentScore != null ? -live.currentScore : NO_LIVE_DATA_EARNINGS;
    return {
      tournamentId,
      golferId,
      earnings,
      finishPosition,
      madeCut: finishPosition !== null,
      isWin: finishPosition === 1,
      isTop5: finishPosition !== null && finishPosition <= 5,
      isTop10: finishPosition !== null && finishPosition <= 10,
    };
  });

  return computeTOCCWeek(tournamentId, toccParticipantIds, weekPicks, syntheticResults, stakes);
}
