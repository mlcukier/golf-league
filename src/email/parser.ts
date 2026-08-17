export type ParsedCommand =
  | { command: "PICK"; golferName: string }
  | { command: "STANDINGS" }
  | { command: "POTS" }
  | { command: "MYPICKS" }
  | { command: "HELP" }
  | { command: "UNKNOWN"; raw: string };

/**
 * Participants email plain text commands to the league inbox. We check the
 * subject line first (so "PICK Scottie Scheffler" as a subject works even
 * with an empty body), then fall back to the first non-blank line of the body.
 */
export function parseCommand(subject: string, body: string): ParsedCommand {
  const candidate = firstNonBlank(subject) ?? firstNonBlank(body) ?? "";
  const trimmed = candidate.trim();
  const upper = trimmed.toUpperCase();

  if (upper === "STANDINGS") return { command: "STANDINGS" };
  if (upper === "POTS") return { command: "POTS" };
  if (upper === "MYPICKS") return { command: "MYPICKS" };
  if (upper === "HELP") return { command: "HELP" };

  if (upper.startsWith("PICK ")) {
    const golferName = trimmed.slice("PICK ".length).trim();
    if (golferName.length > 0) return { command: "PICK", golferName };
  }

  return { command: "UNKNOWN", raw: trimmed };
}

function firstNonBlank(text: string): string | undefined {
  return text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
}
