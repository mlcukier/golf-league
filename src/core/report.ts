import {
  buildEqualQuarterBoundaries,
  computeQuarterlyStandings,
  computeSeasonStandings,
  type StandingRow,
} from "./scoring.js";
import { computeGrellerHistory, type GrellerWeekResult } from "./greller.js";
import {
  computeSidePot1Balance,
  computeSidePot1Tallies,
  determineSidePot1Winners,
  type SidePot1Tally,
} from "./sidePot1.js";
import { computeTOCCWeek, type TOCCWeekResult } from "./tocc.js";
import { distributePlacePayouts, type PayoutRow } from "./payouts.js";
import { openTournament } from "./emailRouting.js";
import {
  seasonPicks,
  seasonResults,
  seasonRoster,
  seasonTournaments,
  toccMemberIds,
  type LeagueData,
} from "../store/store.js";
import type { Season } from "../types.js";

export interface SeasonReport {
  season: Season;
  seasonStandings: StandingRow[];
  quarterStandings: Record<number, StandingRow[]>;
  sidePot1: {
    balance: number;
    tallies: SidePot1Tally[];
    leaders: SidePot1Tally[];
  };
  greller: {
    history: GrellerWeekResult[];
    currentBalance: number;
  };
  tocc: {
    weeks: TOCCWeekResult[];
    /** Net dollars won (positive) or owed (negative) per TOCC participant. */
    netByParticipant: Record<string, number>;
  };
  payouts: {
    /** buyIn * roster size. */
    totalPot: number;
    overall: PayoutRow[];
    /** Quarter number (1-4) -> that quarter's payouts, same schedule applied independently to each. */
    quarters: Record<number, PayoutRow[]>;
  };
  nameByParticipantId: Map<string, string>;
}

/**
 * Computes every standing and pot balance for a season in one pass. This is
 * the single source of truth behind the admin dashboard, the STANDINGS/POTS
 * email replies, and the weekly digest, so all three can never disagree.
 */
export function buildSeasonReport(data: LeagueData, season: Season): SeasonReport {
  const tournaments = seasonTournaments(data, season.id);
  const picks = seasonPicks(data, season.id);
  const results = seasonResults(data, season.id);
  const roster = seasonRoster(data, season.id);
  const toccIds = toccMemberIds(data, season.id);

  const boundaries =
    tournaments.length >= 4 ? buildEqualQuarterBoundaries(tournaments) : [];

  const rosterIds = roster.map((p) => p.id);
  const playedTournamentIds = tournaments.filter((t) => results.some((r) => r.tournamentId === t.id)).map((t) => t.id);
  const tallies = computeSidePot1Tallies(picks, results, rosterIds, playedTournamentIds);

  // The Greller's weekly ante is owed the moment a week opens, not once
  // results come in — the whole roster is on the hook for it whether or not
  // everyone actually got a pick in, so "results not posted yet" isn't a
  // reason to hide that week's contribution from the running pot. Only
  // weeks strictly after the current open one (not yet under way) are
  // excluded.
  const open = openTournament(data, season.id);
  const grellerTournaments = open ? tournaments.filter((t) => t.sequence <= open.sequence) : tournaments;
  const grellerHistory = computeGrellerHistory(
    grellerTournaments,
    picks,
    results,
    roster.length,
    season.grellerWeeklyContribution
  );

  const toccWeeks = tournaments
    .filter((t) => playedTournamentIds.includes(t.id))
    .map((t) =>
      computeTOCCWeek(
        t.id,
        toccIds,
        picks.filter((p) => p.tournamentId === t.id),
        results.filter((r) => r.tournamentId === t.id),
        { stake: season.toccStake, stakeIfWinner: season.toccStakeIfWinner }
      )
    );

  const netByParticipant: Record<string, number> = {};
  for (const id of toccIds) netByParticipant[id] = 0;
  for (const week of toccWeeks) {
    for (const payment of week.payments) {
      netByParticipant[payment.from] = (netByParticipant[payment.from] ?? 0) - payment.amount;
      netByParticipant[payment.to] = (netByParticipant[payment.to] ?? 0) + payment.amount;
    }
  }

  const seasonStandings = computeSeasonStandings(picks, results);
  const quarterStandings = computeQuarterlyStandings(picks, results, tournaments, boundaries);
  const totalPot = season.buyIn * roster.length;
  const quarterPayouts: Record<number, PayoutRow[]> = {};
  for (const q of Object.keys(quarterStandings)) {
    quarterPayouts[Number(q)] = distributePlacePayouts(quarterStandings[Number(q)]!, season.quarterPayouts, totalPot);
  }

  return {
    season,
    seasonStandings,
    quarterStandings,
    sidePot1: {
      balance: computeSidePot1Balance(picks, results, rosterIds, playedTournamentIds, season.missedCutFine),
      tallies,
      leaders: determineSidePot1Winners(tallies),
    },
    greller: {
      history: grellerHistory,
      currentBalance: grellerHistory.at(-1)?.potBalanceAfter ?? 0,
    },
    tocc: { weeks: toccWeeks, netByParticipant },
    payouts: {
      totalPot,
      overall: distributePlacePayouts(seasonStandings, season.overallPayouts, totalPot),
      quarters: quarterPayouts,
    },
    nameByParticipantId: new Map(data.participants.map((p) => [p.id, p.nickname || p.name])),
  };
}
