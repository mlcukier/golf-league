import type { StandingRow } from "../core/scoring.js";
import type { PickRejectionReason } from "../core/oneAndDone.js";
import type { SeasonReport } from "../core/report.js";
import { golferName, type LeagueData } from "../store/store.js";
import type { Pick } from "../types.js";

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

export function renderPots(report: SeasonReport): string {
  const lines: string[] = [`Side Pot 1: $${report.sidePot1.balance.toLocaleString()}`];
  if (report.sidePot1.leaders.length > 0) {
    const leaderNames = report.sidePot1.leaders
      .map((l) => report.nameByParticipantId.get(l.participantId) ?? l.participantId)
      .join(", ");
    lines.push(`  Leading: ${leaderNames} (${report.sidePot1.leaders[0]!.top10s} top-10s)`);
  }

  lines.push(`The Greller: $${report.greller.currentBalance.toLocaleString()}`);

  const toccEntries = Object.entries(report.tocc.netByParticipant);
  if (toccEntries.length > 0) {
    lines.push("TOCC net:");
    for (const [participantId, net] of toccEntries) {
      const name = report.nameByParticipantId.get(participantId) ?? participantId;
      const sign = net >= 0 ? "+" : "-";
      lines.push(`  ${name}: ${sign}$${Math.abs(net).toLocaleString()}`);
    }
  }

  return lines.join("\n");
}

export function renderMyPicks(data: LeagueData, picks: Pick[]): string {
  if (picks.length === 0) return "You haven't made any picks yet this season.";
  const lines = [...picks]
    .sort((a, b) => new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime())
    .map((p) => {
      const tournament = data.tournaments.find((t) => t.id === p.tournamentId);
      return `${tournament?.name ?? p.tournamentId}: ${golferName(data, p.golferId)}`;
    });
  return ["Golfers you've used this season:", ...lines].join("\n");
}

export function renderSetPasswordEmail(
  link: string,
  isReset: boolean
): { subject: string; bodyText: string } {
  const subject = isReset ? "Reset your golf league password" : "Set your golf league password";
  const bodyText = isReset
    ? `Click below to reset your golf league password. This link expires in 1 hour and can only be used once.\n\n${link}\n\nIf you didn't request this, you can ignore this email.`
    : `Welcome to the golf league. Click below to set your password and get picking. This link expires in 1 hour and can only be used once.\n\n${link}`;
  return { subject, bodyText };
}

export const HELP_TEXT = [
  "Commands (put one per email, as the subject or the first line of the body):",
  "  PICK <golfer name>  — submit this week's pick",
  "  STANDINGS           — season + quarterly leaderboard",
  "  POTS                — Side Pot 1 / Greller / TOCC balances",
  "  MYPICKS             — golfers you've already used this season",
  "  HELP                — this message",
].join("\n");
