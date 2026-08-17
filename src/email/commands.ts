import {
  HELP_TEXT,
  renderMyPicks,
  renderPickConfirmation,
  renderPickRejections,
  renderPots,
  renderStandings,
} from "./templates.js";
import { findGolferByName, seasonPicks, tournamentField, type LeagueData } from "../store/store.js";
import { validatePick } from "../core/oneAndDone.js";
import { buildSeasonReport } from "../core/report.js";
import type { Participant, Pick, Season } from "../types.js";

export type ParsedCommand =
  | { command: "PICK"; tournamentId: string; golferName: string }
  | { command: "STANDINGS" }
  | { command: "POTS" }
  | { command: "MYPICKS" }
  | { command: "HELP" }
  | { command: "UNKNOWN"; raw: string };

export interface CommandResult {
  replyText: string;
  /** Set only for a PICK that passed validation; the caller persists it. */
  pickToRecord?: Pick;
}

/**
 * Executes one parsed inbound command against the league data. Pure: it
 * never mutates `data` or touches the store, so the same logic that decides
 * a reply is exactly what's unit tested — the worker just persists
 * `pickToRecord` and sends `replyText`.
 */
export function executeCommand(
  data: LeagueData,
  participant: Participant,
  season: Season,
  command: ParsedCommand,
  now: Date
): CommandResult {
  switch (command.command) {
    case "PICK":
      return executePick(data, participant, season, command.tournamentId, command.golferName, now);

    case "STANDINGS": {
      const report = buildSeasonReport(data, season);
      return {
        replyText: renderStandings(
          `${season.year} season standings`,
          report.seasonStandings,
          report.nameByParticipantId
        ),
      };
    }

    case "POTS":
      return { replyText: renderPots(buildSeasonReport(data, season)) };

    case "MYPICKS": {
      const picks = seasonPicks(data, season.id).filter((p) => p.participantId === participant.id);
      return { replyText: renderMyPicks(data, picks) };
    }

    case "HELP":
      return { replyText: HELP_TEXT };

    case "UNKNOWN":
      return { replyText: `Sorry, I didn't understand "${command.raw}".\n\n${HELP_TEXT}` };
  }
}

function executePick(
  data: LeagueData,
  participant: Participant,
  season: Season,
  tournamentId: string,
  golferNameInput: string,
  now: Date
): CommandResult {
  const tournament = data.tournaments.find((t) => t.id === tournamentId && t.seasonId === season.id);
  if (!tournament) {
    return { replyText: "That tournament isn't part of your season." };
  }

  const golfer = findGolferByName(data, golferNameInput);
  if (!golfer) {
    return {
      replyText: `Couldn't find a golfer named "${golferNameInput}". Check the spelling and try again.`,
    };
  }

  // Exclude the participant's own existing pick for THIS tournament, so
  // they can change their mind before the deadline — every OTHER week's
  // pick still counts, which is what keeps one-and-done intact. The caller
  // is responsible for actually replacing (not just adding) the stored pick.
  const priorPicks = seasonPicks(data, season.id).filter(
    (p) => !(p.participantId === participant.id && p.tournamentId === tournament.id)
  );

  const validation = validatePick({
    participantId: participant.id,
    seasonId: season.id,
    tournamentId: tournament.id,
    golferId: golfer.id,
    receivedAt: now.toISOString(),
    tournamentStartTime: tournament.startTime,
    existingPicks: priorPicks,
    tournamentField: tournamentField(data, tournament.id),
  });

  if (!validation.ok) {
    return { replyText: renderPickRejections(validation.reasons) };
  }

  return {
    replyText: renderPickConfirmation(golfer.name, tournament.name),
    pickToRecord: {
      participantId: participant.id,
      seasonId: season.id,
      tournamentId: tournament.id,
      golferId: golfer.id,
      submittedAt: now.toISOString(),
      source: "web",
    },
  };
}
