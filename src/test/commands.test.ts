import { describe, expect, it } from "vitest";
import { executeCommand } from "../email/commands.js";
import { emptyLeagueData, type LeagueData } from "../store/store.js";
import { SEASON_ID, pick, tournament } from "./fixtures.js";
import type { Golfer, Participant, Season } from "../types.js";

const golfer2: Golfer = { id: "g2", name: "Rory McIlroy" };

const season: Season = {
  id: SEASON_ID,
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
const participant: Participant = { id: "p1", name: "Mark", email: "mark@example.com" };
const golfer: Golfer = { id: "g1", name: "Scottie Scheffler" };

function baseData(): LeagueData {
  const data = emptyLeagueData();
  data.participants.push(participant);
  data.golfers.push(golfer, golfer2);
  return data;
}

describe("executeCommand PICK", () => {
  it("records a valid pick and confirms it", () => {
    const data = baseData();
    const t1 = tournament("t1", 1);
    data.tournaments.push(t1);
    data.fields[t1.id] = [golfer.id];
    const now = new Date(new Date(t1.startTime).getTime() - 1000);

    const result = executeCommand(
      data,
      participant,
      season,
      { command: "PICK", tournamentId: "t1", golferName: "Scottie Scheffler" },
      now
    );

    expect(result.replyText).toContain("Scottie Scheffler");
    expect(result.pickToRecord).toMatchObject({
      participantId: "p1",
      tournamentId: "t1",
      golferId: "g1",
      source: "web",
    });
  });

  it("rejects a pick that arrives after the deadline", () => {
    const data = baseData();
    const t1 = tournament("t1", 1);
    data.tournaments.push(t1);
    data.fields[t1.id] = [golfer.id];
    const now = new Date(new Date(t1.startTime).getTime() + 1000);

    const result = executeCommand(
      data,
      participant,
      season,
      { command: "PICK", tournamentId: "t1", golferName: "Scottie Scheffler" },
      now
    );

    expect(result.pickToRecord).toBeUndefined();
    expect(result.replyText).toMatch(/too late/i);
  });

  it("rejects reusing a golfer already picked in a DIFFERENT week", () => {
    const data = baseData();
    const t1 = tournament("t1", 1);
    const t2 = tournament("t2", 2);
    data.tournaments.push(t1, t2);
    data.fields[t2.id] = [golfer.id];
    data.picks.push(pick(participant.id, t1.id, golfer.id));
    const now = new Date(new Date(t2.startTime).getTime() - 1000);

    const result = executeCommand(
      data,
      participant,
      season,
      { command: "PICK", tournamentId: "t2", golferName: "Scottie Scheffler" },
      now
    );

    expect(result.pickToRecord).toBeUndefined();
    expect(result.replyText).toMatch(/already used/i);
  });

  it("replies clearly when the golfer name doesn't match anyone", () => {
    const data = baseData();
    data.tournaments.push(tournament("t1", 1));

    const result = executeCommand(
      data,
      participant,
      season,
      { command: "PICK", tournamentId: "t1", golferName: "Nobody Special" },
      new Date("2026-01-01T00:00:00Z")
    );

    expect(result.pickToRecord).toBeUndefined();
    expect(result.replyText).toMatch(/couldn't find/i);
  });

  it("rejects a tournamentId that isn't part of the participant's season", () => {
    const data = baseData();
    data.tournaments.push(tournament("t1", 1));

    const result = executeCommand(
      data,
      participant,
      season,
      { command: "PICK", tournamentId: "not-real", golferName: "Scottie Scheffler" },
      new Date("2026-01-01T00:00:00Z")
    );

    expect(result.pickToRecord).toBeUndefined();
    expect(result.replyText).toMatch(/isn't part of your season/i);
  });

  it("allows changing to a different golfer for the same week without an already-used rejection", () => {
    const data = baseData();
    const t1 = tournament("t1", 1);
    data.tournaments.push(t1);
    data.fields[t1.id] = [golfer.id, golfer2.id];
    data.picks.push(pick(participant.id, t1.id, golfer.id)); // originally picked Scheffler
    const now = new Date(new Date(t1.startTime).getTime() - 1000);

    const result = executeCommand(
      data,
      participant,
      season,
      { command: "PICK", tournamentId: "t1", golferName: "Rory McIlroy" },
      now
    );

    expect(result.pickToRecord).toMatchObject({ tournamentId: "t1", golferId: "g2" });
  });

  it("allows resubmitting the same golfer for the same week (a no-op change)", () => {
    const data = baseData();
    const t1 = tournament("t1", 1);
    data.tournaments.push(t1);
    data.fields[t1.id] = [golfer.id];
    data.picks.push(pick(participant.id, t1.id, golfer.id));
    const now = new Date(new Date(t1.startTime).getTime() - 1000);

    const result = executeCommand(
      data,
      participant,
      season,
      { command: "PICK", tournamentId: "t1", golferName: "Scottie Scheffler" },
      now
    );

    expect(result.pickToRecord).toMatchObject({ tournamentId: "t1", golferId: "g1" });
  });

  it("still blocks changing to a golfer already used in a different week", () => {
    const data = baseData();
    const t1 = tournament("t1", 1);
    const t2 = tournament("t2", 2);
    data.tournaments.push(t1, t2);
    data.fields[t2.id] = [golfer.id, golfer2.id];
    data.picks.push(pick(participant.id, t1.id, golfer.id)); // used g1 in week 1
    data.picks.push(pick(participant.id, t2.id, golfer2.id)); // currently on g2 in week 2
    const now = new Date(new Date(t2.startTime).getTime() - 1000);

    // Trying to switch week 2's pick to g1, which is burned from week 1.
    const result = executeCommand(
      data,
      participant,
      season,
      { command: "PICK", tournamentId: "t2", golferName: "Scottie Scheffler" },
      now
    );

    expect(result.pickToRecord).toBeUndefined();
    expect(result.replyText).toMatch(/already used/i);
  });
});

describe("executeCommand other commands", () => {
  it("HELP returns the help text", () => {
    const result = executeCommand(baseData(), participant, season, { command: "HELP" }, new Date());
    expect(result.replyText).toContain("PICK <golfer name>");
  });

  it("STANDINGS includes participant totals", () => {
    const data = baseData();
    const t1 = tournament("t1", 1);
    data.tournaments.push(t1);
    data.picks.push(pick(participant.id, t1.id, golfer.id));
    data.results.push({
      tournamentId: t1.id,
      golferId: golfer.id,
      earnings: 500000,
      finishPosition: 1,
      madeCut: true,
      isWin: true,
      isTop5: true,
      isTop10: true,
    });

    const result = executeCommand(data, participant, season, { command: "STANDINGS" }, new Date());
    expect(result.replyText).toContain("Mark");
    expect(result.replyText).toContain("500,000");
  });

  it("MYPICKS lists used golfers", () => {
    const data = baseData();
    const t1 = tournament("t1", 1);
    data.tournaments.push(t1);
    data.picks.push(pick(participant.id, t1.id, golfer.id));

    const result = executeCommand(data, participant, season, { command: "MYPICKS" }, new Date());
    expect(result.replyText).toContain("Scottie Scheffler");
  });

  it("MYPICKS says so when nothing has been picked yet", () => {
    const result = executeCommand(baseData(), participant, season, { command: "MYPICKS" }, new Date());
    expect(result.replyText).toMatch(/haven't made any picks/i);
  });

  it("POTS reports side pot balances", () => {
    const result = executeCommand(baseData(), participant, season, { command: "POTS" }, new Date());
    expect(result.replyText).toContain("Side Pot");
  });

  it("UNKNOWN replies with the help text", () => {
    const result = executeCommand(
      baseData(),
      participant,
      season,
      { command: "UNKNOWN", raw: "huh" },
      new Date()
    );
    expect(result.replyText).toContain("HELP");
  });
});
