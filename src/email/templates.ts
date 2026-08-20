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
  const lines: string[] = [`Side Pot: $${report.sidePot1.balance.toLocaleString()}`];
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

// ---- HTML email shell, shared by every outbound (non-reply) email below ----

const BRAND = "#1a7a42";
const BG = "#f2f5f2";
const CARD = "#ffffff";
const TEXT = "#1a2e22";
const MUTED = "#6b7d70";
const BORDER = "#e1e8e3";
const ALERT = "#b8860b";

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Wraps a content fragment in the shared card/header shell every notification email uses. */
function emailShell(heading: string, contentHtml: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px 12px;background:${BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${TEXT};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${CARD};border:1px solid ${BORDER};border-radius:10px;overflow:hidden;">
        <tr><td style="padding:18px 24px;border-bottom:1px solid ${BORDER};">
          <span style="font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${MUTED};">⛳ Golf League</span>
        </td></tr>
        <tr><td style="padding:24px;">
          <h1 style="margin:0 0 16px;font-size:19px;line-height:1.3;color:${TEXT};">${escHtml(heading)}</h1>
          ${contentHtml}
        </td></tr>
      </table>
    </td></tr></table>
  </body>
</html>`;
}

function buttonHtml(label: string, href: string): string {
  return `<a href="${escHtml(href)}" style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:6px;font-size:14px;font-weight:600;">${escHtml(label)}</a>`;
}

function paragraphHtml(text: string, color: string = TEXT): string {
  return `<p style="margin:0 0 16px;font-size:15px;line-height:1.5;color:${color};">${escHtml(text)}</p>`;
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
): { subject: string; bodyText: string; bodyHtml: string } {
  const subject = isReset ? "Reset your golf league password" : "Set your golf league password";
  const bodyText = isReset
    ? `Click below to reset your golf league password. This link expires in 1 hour and can only be used once.\n\n${link}\n\nIf you didn't request this, you can ignore this email.`
    : `Welcome to the golf league. Click below to set your password and get picking. This link expires in 1 hour and can only be used once.\n\n${link}`;

  const heading = isReset ? "Reset your password" : "Welcome to the golf league";
  const contentHtml =
    paragraphHtml(
      isReset
        ? "Click below to reset your password. This link expires in 1 hour and can only be used once."
        : "Click below to set your password and get picking. This link expires in 1 hour and can only be used once."
    ) +
    `<p style="margin:0 0 8px;">${buttonHtml(isReset ? "Reset password" : "Set password", link)}</p>` +
    (isReset ? paragraphHtml("If you didn't request this, you can ignore this email.", MUTED) : "");
  const bodyHtml = emailShell(heading, contentHtml);

  return { subject, bodyText, bodyHtml };
}

export function renderPickReminderEmail(
  tournamentName: string,
  deadline: string,
  appUrl: string
): { subject: string; bodyText: string; bodyHtml: string } {
  const subject = `Reminder: pick ${tournamentName} before it starts`;
  const deadlineStr = new Date(deadline).toLocaleString();
  const bodyText =
    `You haven't submitted a pick for the ${tournamentName} yet. Deadline: ` +
    `${deadlineStr} — after that, your Hearn fallback list kicks in ` +
    `(or you take a zero for the week if it's exhausted).\n\nPick here: ${appUrl}`;

  const contentHtml =
    paragraphHtml(`You haven't submitted a pick for ${tournamentName} yet.`) +
    paragraphHtml(
      `Deadline: ${deadlineStr} — after that, your Hearn fallback list kicks in (or you take a zero for the week if it's exhausted).`,
      MUTED
    ) +
    `<p style="margin:0;">${buttonHtml("Make your pick", appUrl)}</p>`;
  const bodyHtml = emailShell(subject, contentHtml);

  return { subject, bodyText, bodyHtml };
}

export interface PicksDigestRow {
  name: string;
  golferName: string | null;
  source: Pick["source"] | null;
  isGrellerAlert: boolean;
}

/** Sent right after a tournament's pick deadline passes — everyone's pick, with a "Greller Alert!!" tag on any pick nobody else made. */
export function renderPicksDigestEmail(
  tournamentName: string,
  rows: PicksDigestRow[]
): { subject: string; bodyText: string; bodyHtml: string } {
  const subject = `Picks are in — ${tournamentName}`;
  const lines = rows.map((r) => {
    const pickText = r.golferName ? r.golferName + (r.source === "hearn" ? " (Hearn)" : "") : "No pick yet";
    return `${r.name}: ${pickText}${r.isGrellerAlert ? "  Greller Alert!!" : ""}`;
  });
  const bodyText = [subject, "", ...lines].join("\n");

  const tableRows = rows
    .map((r) => {
      const pickCell = r.golferName
        ? escHtml(r.golferName) + (r.source === "hearn" ? ` <span style="color:${MUTED};font-size:12px;">(Hearn)</span>` : "")
        : `<span style="color:${MUTED};">No pick yet</span>`;
      const alertCell = r.isGrellerAlert
        ? `<span style="color:${ALERT};font-weight:700;">Greller Alert!!</span>`
        : "";
      return `<tr>
        <td style="padding:9px 8px;border-bottom:1px solid ${BORDER};font-size:14px;">${escHtml(r.name)}</td>
        <td style="padding:9px 8px;border-bottom:1px solid ${BORDER};font-size:14px;">${pickCell}</td>
        <td style="padding:9px 8px;border-bottom:1px solid ${BORDER};font-size:14px;">${alertCell}</td>
      </tr>`;
    })
    .join("");
  const contentHtml = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
    <tr style="text-align:left;">
      <th style="padding:6px 8px;border-bottom:1px solid ${BORDER};font-size:11px;text-transform:uppercase;letter-spacing:.03em;color:${MUTED};">Participant</th>
      <th style="padding:6px 8px;border-bottom:1px solid ${BORDER};font-size:11px;text-transform:uppercase;letter-spacing:.03em;color:${MUTED};">Pick</th>
      <th style="padding:6px 8px;border-bottom:1px solid ${BORDER};"></th>
    </tr>
    ${tableRows}
  </table>`;
  const bodyHtml = emailShell(subject, contentHtml);

  return { subject, bodyText, bodyHtml };
}

export interface ResultsDigestRow {
  name: string;
  golferName: string | null;
  earnings: number;
  finishPosition: number | null;
}

/** Sent after results are posted for a tournament — everyone's pick and how it did. */
export function renderResultsDigestEmail(
  tournamentName: string,
  rows: ResultsDigestRow[]
): { subject: string; bodyText: string; bodyHtml: string } {
  const subject = `Results — ${tournamentName}`;
  const sorted = [...rows].sort((a, b) => b.earnings - a.earnings);
  const lines = sorted.map((r) => {
    if (!r.golferName) return `${r.name}: No pick`;
    const finish = r.finishPosition === null ? "missed cut" : `#${r.finishPosition}`;
    return `${r.name}: ${r.golferName} — ${finish} — $${r.earnings.toLocaleString()}`;
  });
  const bodyText = [subject, "", ...lines].join("\n");

  const tableRows = sorted
    .map((r) => {
      if (!r.golferName) {
        return `<tr>
          <td style="padding:9px 8px;border-bottom:1px solid ${BORDER};font-size:14px;">${escHtml(r.name)}</td>
          <td style="padding:9px 8px;border-bottom:1px solid ${BORDER};font-size:14px;color:${MUTED};" colspan="3">No pick</td>
        </tr>`;
      }
      const finish = r.finishPosition === null
        ? `<span style="color:${MUTED};">missed cut</span>`
        : `#${r.finishPosition}`;
      return `<tr>
        <td style="padding:9px 8px;border-bottom:1px solid ${BORDER};font-size:14px;">${escHtml(r.name)}</td>
        <td style="padding:9px 8px;border-bottom:1px solid ${BORDER};font-size:14px;">${escHtml(r.golferName)}</td>
        <td style="padding:9px 8px;border-bottom:1px solid ${BORDER};font-size:14px;">${finish}</td>
        <td style="padding:9px 8px;border-bottom:1px solid ${BORDER};font-size:14px;text-align:right;font-weight:600;">$${r.earnings.toLocaleString()}</td>
      </tr>`;
    })
    .join("");
  const contentHtml = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
    <tr style="text-align:left;">
      <th style="padding:6px 8px;border-bottom:1px solid ${BORDER};font-size:11px;text-transform:uppercase;letter-spacing:.03em;color:${MUTED};">Participant</th>
      <th style="padding:6px 8px;border-bottom:1px solid ${BORDER};font-size:11px;text-transform:uppercase;letter-spacing:.03em;color:${MUTED};">Golfer</th>
      <th style="padding:6px 8px;border-bottom:1px solid ${BORDER};font-size:11px;text-transform:uppercase;letter-spacing:.03em;color:${MUTED};">Finish</th>
      <th style="padding:6px 8px;border-bottom:1px solid ${BORDER};font-size:11px;text-transform:uppercase;letter-spacing:.03em;color:${MUTED};text-align:right;">Earnings</th>
    </tr>
    ${tableRows}
  </table>`;
  const bodyHtml = emailShell(subject, contentHtml);

  return { subject, bodyText, bodyHtml };
}

/** Free-text admin broadcast to some/all of a season's roster — no fixed structure beyond the shared shell, subject and body are whatever the admin typed. */
export function renderBroadcastEmail(subject: string, message: string): { subject: string; bodyText: string; bodyHtml: string } {
  const paragraphsHtml = message
    .split(/\n{2,}/)
    .map((para) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.5;color:${TEXT};">${escHtml(para).replace(/\n/g, "<br>")}</p>`)
    .join("");
  const bodyHtml = emailShell(subject, paragraphsHtml);
  return { subject, bodyText: message, bodyHtml };
}

// ---- TOCC side action — its own email thread, TOCC members only ----

const TOCC_SUBJECT = "TOCC Side Action Update";

export interface TOCCPicksAnnouncementRow {
  name: string;
  golferName: string | null;
  source: Pick["source"] | null;
  /** Nobody else in the TOCC cohort picked this golfer this week. */
  isSolo: boolean;
}

/**
 * Sent right after the pick deadline, TOCC members only — same idea as the
 * whole-roster picks digest, but "SOLO!" instead of "Greller Alert!!" since
 * uniqueness here is scored against the TOCC cohort, not the whole league.
 */
export function renderTOCCPicksAnnouncementEmail(
  tournamentName: string,
  rows: TOCCPicksAnnouncementRow[]
): { subject: string; bodyText: string; bodyHtml: string } {
  const heading = `TOCC picks — ${tournamentName}`;
  const lines = rows.map((r) => {
    const pickText = r.golferName ? r.golferName + (r.source === "hearn" ? " (Hearn)" : "") : "No pick";
    return `${r.name}: ${pickText}${r.isSolo ? "  SOLO!" : ""}`;
  });
  const bodyText = [heading, "", ...lines].join("\n");

  const tableRows = rows
    .map((r) => {
      const pickCell = r.golferName
        ? escHtml(r.golferName) + (r.source === "hearn" ? ` <span style="color:${MUTED};font-size:12px;">(Hearn)</span>` : "")
        : `<span style="color:${MUTED};">No pick</span>`;
      const soloCell = r.isSolo ? `<span style="color:${ALERT};font-weight:700;">SOLO!</span>` : "";
      return `<tr>
        <td style="padding:9px 8px;border-bottom:1px solid ${BORDER};font-size:14px;">${escHtml(r.name)}</td>
        <td style="padding:9px 8px;border-bottom:1px solid ${BORDER};font-size:14px;">${pickCell}</td>
        <td style="padding:9px 8px;border-bottom:1px solid ${BORDER};font-size:14px;">${soloCell}</td>
      </tr>`;
    })
    .join("");
  const contentHtml = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
    <tr style="text-align:left;">
      <th style="padding:6px 8px;border-bottom:1px solid ${BORDER};font-size:11px;text-transform:uppercase;letter-spacing:.03em;color:${MUTED};">Participant</th>
      <th style="padding:6px 8px;border-bottom:1px solid ${BORDER};font-size:11px;text-transform:uppercase;letter-spacing:.03em;color:${MUTED};">Pick</th>
      <th style="padding:6px 8px;border-bottom:1px solid ${BORDER};"></th>
    </tr>
    ${tableRows}
  </table>`;
  const bodyHtml = emailShell(heading, contentHtml);

  return { subject: TOCC_SUBJECT, bodyText, bodyHtml };
}

const ROUND_LABELS: Record<number, string> = { 1: "Thursday", 2: "Friday", 3: "Saturday", 4: "Sunday — Final" };

export interface TOCCRoundStandingRow {
  name: string;
  golferName: string | null;
  currentPos: string | null;
  currentScore: number | null;
}

export interface TOCCRoundMoney {
  payments: { from: string; to: string; amount: number }[];
  /** Prior weeks' official net plus this week's estimated payments. */
  seasonNet: Record<string, number>;
  nameByParticipantId: Map<string, string>;
}

function formatScore(score: number | null): string {
  if (score === null) return "—";
  if (score === 0) return "E";
  return score > 0 ? `+${score}` : `${score}`;
}

/**
 * Sent once a day's round of play wraps up (Thursday-Sunday), TOCC members
 * only, ordered by current standing. The Sunday send additionally carries
 * `money` — this week's estimated TOCC payouts and the running season
 * balance, computed from live scoring since official earnings won't post
 * for days (see core/toccLive.ts's estimateTOCCWeekFromLive).
 */
export function renderTOCCRoundUpdateEmail(
  tournamentName: string,
  round: number,
  rows: TOCCRoundStandingRow[],
  money?: TOCCRoundMoney
): { subject: string; bodyText: string; bodyHtml: string } {
  const roundLabel = ROUND_LABELS[round] ?? `Round ${round}`;
  const heading = `TOCC standings — ${tournamentName} (${roundLabel})`;

  const lines = rows.map((r) => {
    if (!r.golferName) return `${r.name}: No pick`;
    return `${r.name}: ${r.golferName} — ${r.currentPos ?? "—"} (${formatScore(r.currentScore)})`;
  });
  const moneyLines: string[] = [];
  if (money) {
    moneyLines.push("", "This week's TOCC action (estimate — pending official results):");
    if (money.payments.length === 0) {
      moneyLines.push("  Nobody owes anybody — dead even week.");
    } else {
      for (const p of money.payments) {
        const from = money.nameByParticipantId.get(p.from) ?? p.from;
        const to = money.nameByParticipantId.get(p.to) ?? p.to;
        moneyLines.push(`  ${from} owes ${to} $${p.amount.toLocaleString()}`);
      }
    }
    moneyLines.push("", "Season balance (estimate — includes this week):");
    for (const [participantId, net] of Object.entries(money.seasonNet)) {
      const name = money.nameByParticipantId.get(participantId) ?? participantId;
      const sign = net >= 0 ? "+" : "-";
      moneyLines.push(`  ${name}: ${sign}$${Math.abs(net).toLocaleString()}`);
    }
  }
  const bodyText = [heading, "", ...lines, ...moneyLines].join("\n");

  const tableRows = rows
    .map((r) => {
      if (!r.golferName) {
        return `<tr>
          <td style="padding:9px 8px;border-bottom:1px solid ${BORDER};font-size:14px;">${escHtml(r.name)}</td>
          <td style="padding:9px 8px;border-bottom:1px solid ${BORDER};font-size:14px;color:${MUTED};" colspan="3">No pick</td>
        </tr>`;
      }
      return `<tr>
        <td style="padding:9px 8px;border-bottom:1px solid ${BORDER};font-size:14px;">${escHtml(r.name)}</td>
        <td style="padding:9px 8px;border-bottom:1px solid ${BORDER};font-size:14px;">${escHtml(r.golferName)}</td>
        <td style="padding:9px 8px;border-bottom:1px solid ${BORDER};font-size:14px;">${escHtml(r.currentPos ?? "—")}</td>
        <td style="padding:9px 8px;border-bottom:1px solid ${BORDER};font-size:14px;text-align:right;">${escHtml(formatScore(r.currentScore))}</td>
      </tr>`;
    })
    .join("");

  let moneyHtml = "";
  if (money) {
    const paymentsHtml =
      money.payments.length === 0
        ? `<p style="margin:0 0 8px;font-size:14px;color:${MUTED};">Nobody owes anybody — dead even week.</p>`
        : money.payments
            .map((p) => {
              const from = escHtml(money.nameByParticipantId.get(p.from) ?? p.from);
              const to = escHtml(money.nameByParticipantId.get(p.to) ?? p.to);
              return `<p style="margin:0 0 6px;font-size:14px;">${from} owes ${to} <strong>$${p.amount.toLocaleString()}</strong></p>`;
            })
            .join("");
    const netHtml = Object.entries(money.seasonNet)
      .map(([participantId, net]) => {
        const name = escHtml(money.nameByParticipantId.get(participantId) ?? participantId);
        const sign = net >= 0 ? "+" : "-";
        const color = net >= 0 ? BRAND : "#b8302a";
        return `<p style="margin:0 0 6px;font-size:14px;">${name}: <strong style="color:${color};">${sign}$${Math.abs(net).toLocaleString()}</strong></p>`;
      })
      .join("");
    moneyHtml = `
      <h2 style="margin:20px 0 8px;font-size:14px;color:${TEXT};">This week's TOCC action</h2>
      <p style="margin:0 0 10px;font-size:12px;color:${MUTED};">Estimated from live scoring — final once official results are posted.</p>
      ${paymentsHtml}
      <h2 style="margin:20px 0 8px;font-size:14px;color:${TEXT};">Season balance</h2>
      ${netHtml}
    `;
  }

  const contentHtml = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
    <tr style="text-align:left;">
      <th style="padding:6px 8px;border-bottom:1px solid ${BORDER};font-size:11px;text-transform:uppercase;letter-spacing:.03em;color:${MUTED};">Participant</th>
      <th style="padding:6px 8px;border-bottom:1px solid ${BORDER};font-size:11px;text-transform:uppercase;letter-spacing:.03em;color:${MUTED};">Golfer</th>
      <th style="padding:6px 8px;border-bottom:1px solid ${BORDER};font-size:11px;text-transform:uppercase;letter-spacing:.03em;color:${MUTED};">Pos</th>
      <th style="padding:6px 8px;border-bottom:1px solid ${BORDER};font-size:11px;text-transform:uppercase;letter-spacing:.03em;color:${MUTED};text-align:right;">Score</th>
    </tr>
    ${tableRows}
  </table>${moneyHtml}`;
  const bodyHtml = emailShell(heading, contentHtml);

  return { subject: TOCC_SUBJECT, bodyText, bodyHtml };
}

export const HELP_TEXT = [
  "Commands (put one per email, as the subject or the first line of the body):",
  "  PICK <golfer name>  — submit this week's pick",
  "  STANDINGS           — season + quarterly leaderboard",
  "  POTS                — Side Pot / Greller / TOCC balances",
  "  MYPICKS             — golfers you've already used this season",
  "  HELP                — this message",
].join("\n");
