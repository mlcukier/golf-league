import type { StandingRow } from "../core/scoring.js";
import type { PickRejectionReason } from "../core/oneAndDone.js";

const REJECTION_MESSAGES: Record<PickRejectionReason, string> = {
  GOLFER_ALREADY_USED: "You've already used that golfer earlier this season — pick someone new.",
  ALREADY_PICKED_THIS_WEEK: "You've already submitted a pick for this week. Reply HELP if you need to change it.",
  GOLFER_NOT_IN_FIELD: "That golfer isn't in this week's tournament field. Check the spelling and try again.",
  PAST_DEADLINE: "Sorry, that arrived after the tournament started, so it's too late for this week.",
};

export function renderPickConfirmation(golferName: string, tournamentName: string): string {
  return `You're locked in with ${golferName} for the ${tournamentName}. Good luck!`;
}

export function renderPickRejection(reason: PickRejectionReason): string {
  return REJECTION_MESSAGES[reason];
}

/** Explains every violation at once, so one reply covers a multi-problem pick. */
export function renderPickRejections(reasons: PickRejectionReason[]): string {
  const unique = [...new Set(reasons)];
  if (unique.length <= 1) return renderPickRejection(unique[0] ?? "GOLFER_NOT_IN_FIELD");
  return unique.map((r) => `• ${REJECTION_MESSAGES[r]}`).join("\n");
}

export function renderHearnAssignment(golferName: string, tournamentName: string): string {
  return (
    `No pick arrived before the ${tournamentName} started, so your Hearn list ` +
    `was used: you're in with ${golferName}.`
  );
}

export function renderHearnExhausted(tournamentName: string): string {
  return (
    `No pick arrived before the ${tournamentName} started and every golfer on ` +
    `your Hearn list is either already used this season or not in the field, ` +
    `so you have no pick this week. Reply with an updated list to avoid a repeat.`
  );
}

export function renderStandings(
  title: string,
  rows: StandingRow[],
  nameByParticipantId: Map<string, string>
): string {
  const lines = rows.map((row, i) => {
    const name = nameByParticipantId.get(row.participantId) ?? row.participantId;
    return `${i + 1}. ${name} — $${row.totalEarnings.toLocaleString()}`;
  });
  return [title, ...lines].join("\n");
}

export const HELP_TEXT = [
  "Commands (put one per email, as the subject or the first line of the body):",
  "  PICK <golfer name>  — submit this week's pick",
  "  STANDINGS           — season + quarterly leaderboard",
  "  POTS                — Side Pot 1 / Greller / TOCC balances",
  "  MYPICKS             — golfers you've already used this season",
  "  HELP                — this message",
].join("\n");
