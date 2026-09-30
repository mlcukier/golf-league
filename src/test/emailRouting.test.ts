import { describe, expect, it } from "vitest";
import {
  EVENT_COMPLETION_BUFFER_MS,
  openTournament,
  resolveActiveSeasonForParticipant,
} from "../core/emailRouting.js";
import { emptyLeagueData, type LeagueData } from "../store/store.js";
import { result, tournament } from "./fixtures.js";
import type { League, Participant, Season } from "../types.js";

const league: League = { id: "lg1", name: "Main League", isTest: false, createdAt: "2026-01-01T00:00:00Z" };
const testLeague: League = {
  id: "lg-test",
  name: "Test League 2026",
  isTest: true,
  createdAt: "2026-01-01T00:00:00Z",
};
const season: Season = {
  id: "s2026",
  leagueId: "lg1",
  year: 2026,
  status: "ACTIVE",
  startDate: "2026-01-01",
  endDate: null,
  grellerWeeklyContribution: 10,
  missedCutFine: 50,
  toccStake: 100,
  toccStakeIfWinner: 200,
  buyIn: 0,
  overallPayouts: [],
  quarterPayouts: [],
};
const testSeason: Season = { ...season, id: "s2026-test", leagueId: "lg-test" };
const participant: Participant = { id: "p1", name: "Mark", email: "mark@example.com" };

function baseData(): LeagueData {
  return emptyLeagueData();
}

describe("resolveActiveSeasonForParticipant", () => {
  it("fails for an email with no matching participant", () => {
    const data = baseData();
    expect(resolveActiveSeasonForParticipant(data, "nobody@example.com").failure).toBe(
      "NOT_A_PARTICIPANT"
    );
  });

  it("matches the participant's email case-insensitively", () => {
    const data = baseData();
    data.participants.push(participant);
    data.leagues.push(league);
    data.seasons.push(season);
    data.seasonEntries.push({ seasonId: season.id, participantId: participant.id, isTOCCMember: false });

    const result = resolveActiveSeasonForParticipant(data, "MARK@EXAMPLE.COM");
    expect(result.ok).toBe(true);
    expect(result.season?.id).toBe(season.id);
  });

  it("fails when the participant's only season isn't active", () => {
    const data = baseData();
    data.participants.push(participant);
    data.leagues.push(league);
    data.seasons.push({ ...season, status: "DRAFT" });
    data.seasonEntries.push({ seasonId: season.id, participantId: participant.id, isTOCCMember: false });

    expect(resolveActiveSeasonForParticipant(data, participant.email).failure).toBe("NO_ACTIVE_SEASON");
  });

  it("prefers the real league over a concurrently active test league", () => {
    const data = baseData();
    data.participants.push(participant);
    data.leagues.push(league, testLeague);
    data.seasons.push(season, testSeason);
    data.seasonEntries.push(
      { seasonId: season.id, participantId: participant.id, isTOCCMember: false },
      { seasonId: testSeason.id, participantId: participant.id, isTOCCMember: false }
    );

    const result = resolveActiveSeasonForParticipant(data, participant.email);
    expect(result.ok).toBe(true);
    expect(result.season?.id).toBe(season.id);
  });

  it("is ambiguous when two real-league seasons are both active", () => {
    const data = baseData();
    const league2: League = { ...league, id: "lg2" };
    const season2: Season = { ...season, id: "s-other", leagueId: "lg2" };
    data.participants.push(participant);
    data.leagues.push(league, league2);
    data.seasons.push(season, season2);
    data.seasonEntries.push(
      { seasonId: season.id, participantId: participant.id, isTOCCMember: false },
      { seasonId: season2.id, participantId: participant.id, isTOCCMember: false }
    );

    expect(resolveActiveSeasonForParticipant(data, participant.email).failure).toBe(
      "AMBIGUOUS_SEASON"
    );
  });
});

// Fixture cadence: event N starts Jan (8 + 7*(N-1)) 2026 at 08:00Z, and is
// treated as conclusively over EVENT_COMPLETION_BUFFER_MS (4 days) later.
const BEFORE_T1 = new Date("2026-01-07T00:00:00Z"); // nothing started yet
const DURING_T1 = new Date("2026-01-09T12:00:00Z"); // t1 under way, past its deadline
const AFTER_T1 = new Date("2026-01-13T00:00:00Z"); // t1 over, t2 not yet started

describe("openTournament", () => {
  it("returns the earliest tournament in the season", () => {
    const data = baseData();
    data.tournaments.push(tournament("t1", 1), tournament("t2", 2));
    expect(openTournament(data, "s2026", BEFORE_T1)?.id).toBe("t1");
  });

  it("skips a tournament once results are posted for it, regardless of any participant's pick status", () => {
    // E.g. a participant missed the deadline with no valid Hearn fallback
    // (hearn.ts never creates a pick in that case) — once the week is over,
    // it must not block every future pick forever for anyone.
    const data = baseData();
    const t1 = tournament("t1", 1);
    const t2 = tournament("t2", 2);
    data.tournaments.push(t1, t2);
    data.results.push(result(t1.id, "g1", 0, null));
    expect(openTournament(data, "s2026", DURING_T1)?.id).toBe("t2");
  });

  it("returns undefined once every tournament has posted results", () => {
    const data = baseData();
    const t1 = tournament("t1", 1);
    data.tournaments.push(t1);
    data.results.push(result(t1.id, "g1", 0, null));
    expect(openTournament(data, "s2026", DURING_T1)).toBeUndefined();
  });

  it("does not skip an in-progress tournament with no results yet, even past its clock deadline", () => {
    const data = baseData();
    const t1 = tournament("t1", 1);
    data.tournaments.push(t1);
    // No results posted and still inside the completion buffer — the
    // tournament is still being played, so it must still be the target.
    expect(openTournament(data, "s2026", DURING_T1)?.id).toBe("t1");
  });

  it("keeps a just-started tournament as the target so a late pick is rejected, not silently aimed at next week", () => {
    const data = baseData();
    const t1 = tournament("t1", 1); // already started, no results yet
    const t2 = tournament("t2", 2); // not started
    data.tournaments.push(t1, t2);
    expect(openTournament(data, "s2026", DURING_T1)?.id).toBe("t1");
  });

  it("rolls past a finished tournament that never got results, instead of blocking the season forever", () => {
    // The 2026 Presidents Cup: a no-prize-money team exhibition DataGolf
    // doesn't carry in the PGA calendar, so its results pull 400s forever.
    // Before this, it pinned openTournament permanently — participants were
    // shown a pick due for an event that had ended days earlier, and the
    // field sweep never advanced to the next tournament.
    const data = baseData();
    const t1 = tournament("t1", 1);
    const t2 = tournament("t2", 2);
    data.tournaments.push(t1, t2);
    expect(openTournament(data, "s2026", AFTER_T1)?.id).toBe("t2");
  });

  it("rolls past several consecutive resultless finished tournaments", () => {
    const data = baseData();
    data.tournaments.push(tournament("t1", 1), tournament("t2", 2), tournament("t3", 3));
    // Jan 20: t1 and t2 are both over with no results; t3 (Jan 22) is next.
    expect(openTournament(data, "s2026", new Date("2026-01-20T00:00:00Z"))?.id).toBe("t3");
  });

  it("returns undefined when every tournament is finished, with or without results", () => {
    const data = baseData();
    data.tournaments.push(tournament("t1", 1), tournament("t2", 2));
    expect(openTournament(data, "s2026", new Date("2026-03-01T00:00:00Z"))).toBeUndefined();
  });

  it("treats the completion boundary as inclusive — exactly 4 days after the start, the week has rolled over", () => {
    const data = baseData();
    const t1 = tournament("t1", 1);
    const t2 = tournament("t2", 2);
    data.tournaments.push(t1, t2);
    const boundary = new Date(new Date(t1.startTime).getTime() + EVENT_COMPLETION_BUFFER_MS);
    expect(openTournament(data, "s2026", new Date(boundary.getTime() - 1))?.id).toBe("t1");
    expect(openTournament(data, "s2026", boundary)?.id).toBe("t2");
  });
});
