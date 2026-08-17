import { describe, expect, it } from "vitest";
import { openTournament, resolveActiveSeasonForParticipant } from "../core/emailRouting.js";
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

describe("openTournament", () => {
  it("returns the earliest tournament in the season", () => {
    const data = baseData();
    data.tournaments.push(tournament("t1", 1), tournament("t2", 2));
    expect(openTournament(data, "s2026")?.id).toBe("t1");
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
    expect(openTournament(data, "s2026")?.id).toBe("t2");
  });

  it("returns undefined once every tournament has posted results", () => {
    const data = baseData();
    const t1 = tournament("t1", 1);
    data.tournaments.push(t1);
    data.results.push(result(t1.id, "g1", 0, null));
    expect(openTournament(data, "s2026")).toBeUndefined();
  });

  it("does not skip an in-progress tournament with no results yet, even past its clock deadline", () => {
    const data = baseData();
    const t1 = tournament("t1", 1);
    data.tournaments.push(t1);
    // No results posted — the tournament is still being played (or hasn't
    // had its Hearn/results step run yet), so it must still be the target.
    expect(openTournament(data, "s2026")?.id).toBe("t1");
  });

  it("is independent of the clock — a late pick target stays the started tournament, not next week", () => {
    const data = baseData();
    const t1 = tournament("t1", 1); // already started, no results yet
    const t2 = tournament("t2", 2); // not started
    data.tournaments.push(t1, t2);
    expect(openTournament(data, "s2026")?.id).toBe("t1");
  });
});
