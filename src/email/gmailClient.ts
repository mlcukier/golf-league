import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { google } from "googleapis";

export type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;

export interface GmailMessage {
  id: string;
  threadId: string;
  internalDateMs: number;
  subject: string;
  fromAddrs: string[];
  toAddrs: string[];
  ccAddrs: string[];
  bodyText: string;
}

interface GmailPart {
  mimeType?: string | null;
  body?: { data?: string | null } | null;
  parts?: GmailPart[] | null;
}

function parseAddressList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => {
      const m = x.match(/<([^>]+)>/);
      return (m ? m[1]! : x).trim().toLowerCase();
    });
}

function decodeBase64Url(str: string): Buffer {
  const s = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s + pad, "base64");
}

function encodeBase64Url(raw: string): string {
  return Buffer.from(raw)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function headerValue(headers: { name?: string | null; value?: string | null }[], name: string): string {
  const h = headers.find((x) => x.name?.toLowerCase() === name.toLowerCase());
  return h?.value ?? "";
}

function findPart(payload: GmailPart | null | undefined, mimeType: string): GmailPart | null {
  if (!payload) return null;
  if (payload.mimeType === mimeType && payload.body?.data) return payload;
  for (const part of payload.parts ?? []) {
    const found = findPart(part, mimeType);
    if (found) return found;
  }
  return null;
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export interface GmailAuthOptions {
  /** State dir shared with other Gmail-connected apps on this box (e.g. gmail-worker). */
  stateDir: string;
}

/**
 * Reuses the OAuth client + refresh token already authorized by another app
 * on this box instead of running a separate consent flow. Gmail "+"
 * addresses (mlcukier+golfleague@gmail.com) all land in the same inbox that
 * token already has access to, so no new Google Cloud setup is needed —
 * just the same gmail.modify/gmail.send scopes gmail-worker already has.
 */
export async function getAuthedClient({ stateDir }: GmailAuthOptions): Promise<OAuth2Client> {
  const clientPath = path.join(stateDir, "google-oauth.json");
  const tokenPath = path.join(stateDir, "google-token.json");

  if (!existsSync(clientPath)) {
    throw new Error(
      `Missing OAuth client file at ${clientPath}. This should already exist from another Gmail-connected app on this box (see gmail-worker).`
    );
  }
  if (!existsSync(tokenPath)) {
    throw new Error(`Missing OAuth token at ${tokenPath}. Authorize the existing Gmail app first.`);
  }

  const clientJson = JSON.parse(await readFile(clientPath, "utf8"));
  const cfg = clientJson.installed ?? clientJson.web;
  if (!cfg) throw new Error("google-oauth.json missing installed/web section");
  const redirectUri: string =
    (cfg.redirect_uris ?? []).find((u: string) => u.startsWith("http://localhost")) ??
    cfg.redirect_uris?.[0];

  const oAuth2Client = new google.auth.OAuth2(cfg.client_id, cfg.client_secret, redirectUri);
  const token = JSON.parse(await readFile(tokenPath, "utf8"));
  oAuth2Client.setCredentials(token);

  // Persist refreshed access tokens back to the shared file, same as gmail-worker does.
  oAuth2Client.on("tokens", (tokens) => {
    void writeFile(tokenPath, JSON.stringify({ ...token, ...tokens }, null, 2)).catch((err) => {
      console.error("Failed to persist refreshed Gmail token:", err);
    });
  });

  return oAuth2Client;
}

export async function listMessageIds(
  auth: OAuth2Client,
  query: string,
  maxResults: number
): Promise<string[]> {
  const gmail = google.gmail({ version: "v1", auth });
  const resp = await gmail.users.messages.list({ userId: "me", q: query, maxResults });
  return (resp.data.messages ?? []).map((m) => m.id).filter((id): id is string => Boolean(id));
}

export async function getMessage(auth: OAuth2Client, id: string): Promise<GmailMessage> {
  const gmail = google.gmail({ version: "v1", auth });
  const resp = await gmail.users.messages.get({ userId: "me", id, format: "full" });
  const msg = resp.data;
  const headers = msg.payload?.headers ?? [];

  const fromAddrs = parseAddressList(headerValue(headers, "From"));
  const toAddrs = parseAddressList(headerValue(headers, "To"));
  const ccAddrs = parseAddressList(headerValue(headers, "Cc"));
  const subject = headerValue(headers, "Subject");

  let bodyText = "";
  const textPart = findPart(msg.payload, "text/plain");
  if (textPart?.body?.data) {
    bodyText = decodeBase64Url(textPart.body.data).toString("utf8");
  } else {
    const htmlPart = findPart(msg.payload, "text/html");
    if (htmlPart?.body?.data) bodyText = stripHtml(decodeBase64Url(htmlPart.body.data).toString("utf8"));
  }

  return {
    id: msg.id!,
    threadId: msg.threadId!,
    internalDateMs: Number(msg.internalDate ?? 0),
    subject,
    fromAddrs,
    toAddrs,
    ccAddrs,
    bodyText,
  };
}

export async function ensureLabel(auth: OAuth2Client, name: string): Promise<string> {
  const gmail = google.gmail({ version: "v1", auth });
  const list = await gmail.users.labels.list({ userId: "me" });
  const existing = (list.data.labels ?? []).find((l) => l.name === name);
  if (existing?.id) return existing.id;
  const created = await gmail.users.labels.create({
    userId: "me",
    requestBody: { name, labelListVisibility: "labelShow", messageListVisibility: "show" },
  });
  return created.data.id!;
}

export async function addLabel(auth: OAuth2Client, id: string, labelId: string): Promise<void> {
  const gmail = google.gmail({ version: "v1", auth });
  await gmail.users.messages.modify({ userId: "me", id, requestBody: { addLabelIds: [labelId] } });
}

export async function markRead(auth: OAuth2Client, id: string): Promise<void> {
  const gmail = google.gmail({ version: "v1", auth });
  await gmail.users.messages.modify({ userId: "me", id, requestBody: { removeLabelIds: ["UNREAD"] } });
}

export async function sendThreadReply(
  auth: OAuth2Client,
  args: { threadId: string; to: string; subject: string; bodyText: string }
): Promise<void> {
  const gmail = google.gmail({ version: "v1", auth });
  const subject = args.subject.toLowerCase().startsWith("re:") ? args.subject : `Re: ${args.subject}`;
  const raw = [
    `To: ${args.to}`,
    `Subject: ${subject}`,
    `In-Reply-To: ${args.threadId}`,
    `References: ${args.threadId}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "",
    args.bodyText,
    "",
  ].join("\r\n");
  await gmail.users.messages.send({
    userId: "me",
    requestBody: { threadId: args.threadId, raw: encodeBase64Url(raw) },
  });
}

/** A plain, non-threaded email — used for password-setup links and (later) digests/reminders. */
export async function sendEmail(
  auth: OAuth2Client,
  args: { to: string; subject: string; bodyText: string }
): Promise<void> {
  const gmail = google.gmail({ version: "v1", auth });
  const raw = [
    `To: ${args.to}`,
    `Subject: ${args.subject}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "",
    args.bodyText,
    "",
  ].join("\r\n");
  await gmail.users.messages.send({ userId: "me", requestBody: { raw: encodeBase64Url(raw) } });
}
