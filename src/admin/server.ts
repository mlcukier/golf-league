import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import type { LeagueStore } from "../store/store.js";
import {
  findGolferByName,
  findParticipantByEmail,
  golferName,
  seasonPicks,
  seasonRoster,
  seasonTournaments,
  toccMemberIds,
  tournamentField,
  upsertGolfer,
  type LeagueData,
} from "../store/store.js";
import { buildSeasonReport } from "../core/report.js";
import { computeGolferAvailability, getAvailability } from "../core/availability.js";
import { blockingReasons, validatePick } from "../core/oneAndDone.js";
import { applyHearnFallbacks, findDeadHearnEntries } from "../core/hearn.js";
import { createSeason, createTestLeague, startNewSeason } from "../core/season.js";
import { openTournament, resolveActiveSeasonForParticipant } from "../core/emailRouting.js";
import { buildTOCCLiveStandings, estimateTOCCWeekFromLive } from "../core/toccLive.js";
import {
  PASSWORD_RESET_TOKEN_TTL_MS,
  SESSION_MAX_AGE_MS,
  generateToken,
  hashPassword,
  isPasswordResetTokenExpired,
  signSession,
  verifyPassword,
  verifySession,
} from "../core/auth.js";
import { executeCommand } from "../email/commands.js";
import {
  renderBroadcastEmail,
  renderResultsDigestEmail,
  renderSetPasswordEmail,
  renderTOCCRoundUpdateEmail,
} from "../email/templates.js";
import { getAuthedClient, sendEmail, type OAuth2Client } from "../email/gmailClient.js";
import { createOddsCache, oddsForTournament, type OddsCache } from "../providers/dataGolfOdds.js";
import { createPlayerListCache, type PlayerListCache } from "../providers/dataGolfPlayers.js";
import { createGolferFormCache, type GolferFormCache } from "../providers/dataGolfForm.js";
import { fetchLiveInPlay, liveDataForTournament } from "../providers/dataGolfLive.js";
import { sendPickRemindersNow, sendPicksDigestFor, sendTOCCPicksAnnouncementFor } from "../jobs/notifications.js";
import type { Participant, Season } from "../types.js";
import { ADMIN_HTML } from "./html.js";

export type SendMail = (args: { to: string; subject: string; bodyText: string; bodyHtml?: string }) => Promise<void>;
type RouteAuth = "public" | "auth" | "admin";

interface Route {
  method: string;
  pattern: RegExp;
  /** public = anyone, auth = any logged-in participant, admin = isAdmin only. */
  auth: RouteAuth;
  handler: (ctx: RouteContext) => Promise<unknown>;
}

interface RouteContext {
  params: string[];
  body: Record<string, unknown>;
  query: URLSearchParams;
  store: LeagueStore;
  /** The logged-in participant, if any. Non-null is guaranteed for auth/admin routes by dispatch. */
  me: Participant | null;
  baseUrl: string;
  setCookie: (participant: Participant) => void;
  clearCookie: () => void;
  sendMail: SendMail;
  /** null when DATAGOLF_API_KEY isn't configured — odds are an optional nicety, never required. */
  oddsCache: OddsCache | null;
  /** null when DATAGOLF_API_KEY isn't configured — the Hearn picker then falls back to just the open tournament's field. */
  playerListCache: PlayerListCache | null;
  /** null when DATAGOLF_API_KEY isn't configured — recent-form/course-history sections are then omitted from the pick page. */
  golferFormCache: GolferFormCache | null;
  /** undefined when DATAGOLF_API_KEY isn't configured — the admin Emails tab's TOCC Round Update "send now" is then unavailable. */
  dataGolfApiKey?: string;
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function requireSeason(data: LeagueData, seasonId: string): Season {
  const season = data.seasons.find((s) => s.id === seasonId);
  if (!season) throw new HttpError(404, `No season ${seasonId}`);
  return season;
}

function meShape(p: Participant) {
  return {
    id: p.id,
    name: p.name,
    nickname: p.nickname ?? null,
    email: p.email,
    isAdmin: Boolean(p.isAdmin),
    hasPassword: Boolean(p.passwordHash),
  };
}

function describeLookupFailure(failure: string | undefined): string {
  switch (failure) {
    case "NOT_A_PARTICIPANT":
      return "This account isn't on a golf league roster. Ask the admin to add you.";
    case "NO_ACTIVE_SEASON":
      return "You're not on the roster of any currently active season.";
    case "AMBIGUOUS_SEASON":
      return "You're on the roster of more than one active season — ask the admin to sort this out.";
    default:
      return "Something went wrong resolving your season.";
  }
}

/**
 * Emails the roster of a tournament's season everyone's pick and how it did,
 * best-effort. Fires every time results are (re)posted for that tournament —
 * event-driven off the admin action, not a scheduled sweep, so an edited
 * result correctly sends an updated digest rather than needing dedupe state.
 * Runs for test leagues too (by design, so they're usable as a live
 * rehearsal) — sends to whatever's on the roster, real or fake addresses.
 */
async function sendResultsDigest(data: LeagueData, tournamentId: string, sendMail: SendMail): Promise<void> {
  const tournament = data.tournaments.find((t) => t.id === tournamentId);
  if (!tournament) return;
  const season = data.seasons.find((s) => s.id === tournament.seasonId);
  if (!season) return;

  const roster = seasonRoster(data, season.id);
  if (roster.length === 0) return;
  const weekPicks = seasonPicks(data, season.id).filter((p) => p.tournamentId === tournamentId);
  const resultByGolfer = new Map(
    data.results.filter((r) => r.tournamentId === tournamentId).map((r) => [r.golferId, r])
  );

  const rows = roster.map((p) => {
    const pick = weekPicks.find((wp) => wp.participantId === p.id);
    const result = pick ? resultByGolfer.get(pick.golferId) : undefined;
    return {
      name: p.nickname || p.name,
      golferName: pick ? golferName(data, pick.golferId) : null,
      earnings: result?.earnings ?? 0,
      finishPosition: result?.finishPosition ?? null,
    };
  });

  const { subject, bodyText, bodyHtml } = renderResultsDigestEmail(tournament.name, rows);
  const recipients = roster.map((p) => p.email).join(", ");
  try {
    await sendMail({ to: recipients, subject, bodyText, bodyHtml });
  } catch (err) {
    console.error(`Failed to send results digest for ${tournament.name}:`, err);
  }
}

export interface ResultRow {
  golferName: string;
  earnings: number;
  finishPosition: number | null;
}

/**
 * Replaces a tournament's results and sends the results digest — the one
 * path both the admin paste route and the DataGolf auto-pull job
 * (jobs/resultsPull.ts) go through, so "results changed" always means the
 * same thing regardless of where the rows came from.
 */
export async function applyResults(
  store: LeagueStore,
  tournamentId: string,
  rows: ResultRow[],
  sendMail: SendMail
): Promise<number> {
  const updated = await store.update((d) => {
    d.results = d.results.filter((r) => r.tournamentId !== tournamentId);
    for (const row of rows) {
      const golfer = upsertGolfer(d, row.golferName);
      d.results.push({
        tournamentId,
        golferId: golfer.id,
        earnings: row.earnings,
        finishPosition: row.finishPosition,
        madeCut: row.finishPosition !== null,
        isWin: row.finishPosition === 1,
        isTop5: row.finishPosition !== null && row.finishPosition <= 5,
        isTop10: row.finishPosition !== null && row.finishPosition <= 10,
      });
    }
  });
  await sendResultsDigest(updated, tournamentId, sendMail);
  return rows.length;
}

/** Creates (or replaces) a one-time password link for a participant and emails it, best-effort. */
async function issuePasswordEmail(
  store: LeagueStore,
  sendMail: SendMail,
  baseUrl: string,
  participant: Participant
): Promise<void> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_MS).toISOString();
  await store.update((d) => {
    d.passwordResetTokens = d.passwordResetTokens.filter((t) => t.participantId !== participant.id);
    d.passwordResetTokens.push({ token, participantId: participant.id, expiresAt });
  });
  const link = `${baseUrl}/?setpw=${token}`;
  const { subject, bodyText, bodyHtml } = renderSetPasswordEmail(link, Boolean(participant.passwordHash));
  try {
    await sendMail({ to: participant.email, subject, bodyText, bodyHtml });
  } catch (err) {
    console.error(`Failed to send password email to ${participant.email}:`, err);
  }
}

const routes: Route[] = [
  // ---- auth -----------------------------------------------------------------
  {
    method: "POST",
    pattern: /^\/api\/auth\/login$/,
    auth: "public",
    handler: async ({ body, store, setCookie }) => {
      const email = String(body.email ?? "").trim().toLowerCase();
      const password = String(body.password ?? "");
      const data = await store.read();
      const participant = findParticipantByEmail(data, email);
      if (!participant?.passwordHash || !verifyPassword(password, participant.passwordHash)) {
        throw new HttpError(401, "Incorrect email or password");
      }
      setCookie(participant);
      return meShape(participant);
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/auth\/logout$/,
    auth: "public",
    handler: async ({ clearCookie }) => {
      clearCookie();
      return { ok: true };
    },
  },
  {
    /** Always reports success, whether or not the email matches, so this can't be used to enumerate participants. */
    method: "POST",
    pattern: /^\/api\/auth\/request-reset$/,
    auth: "public",
    handler: async ({ body, store, baseUrl, sendMail }) => {
      const email = String(body.email ?? "").trim().toLowerCase();
      const data = await store.read();
      const participant = findParticipantByEmail(data, email);
      if (participant) await issuePasswordEmail(store, sendMail, baseUrl, participant);
      return { ok: true };
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/auth\/set-password$/,
    auth: "public",
    handler: async ({ body, store, setCookie }) => {
      const token = String(body.token ?? "");
      const password = String(body.password ?? "");
      if (password.length < 8) throw new HttpError(400, "Password must be at least 8 characters");

      const data = await store.read();
      const entry = data.passwordResetTokens.find((t) => t.token === token);
      if (!entry || isPasswordResetTokenExpired(entry) || !data.participants.some((p) => p.id === entry.participantId)) {
        throw new HttpError(400, "This link is invalid or has expired. Request a new one.");
      }

      const passwordSetAt = new Date().toISOString();
      const passwordHash = hashPassword(password);
      let updated: Participant | undefined;
      await store.update((d) => {
        const p = d.participants.find((x) => x.id === entry.participantId);
        if (!p) return;
        p.passwordHash = passwordHash;
        p.passwordSetAt = passwordSetAt;
        d.passwordResetTokens = d.passwordResetTokens.filter((t) => t.token !== token);
        updated = p;
      });
      if (!updated) throw new HttpError(400, "This link is invalid or has expired. Request a new one.");
      setCookie(updated);
      return meShape(updated);
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/me$/,
    auth: "auth",
    handler: async ({ me }) => meShape(me!),
  },

  // ---- self-service (any logged-in participant) ------------------------------
  {
    method: "GET",
    pattern: /^\/api\/my\/state$/,
    auth: "auth",
    handler: async ({ me, store, oddsCache, playerListCache, golferFormCache }) => {
      const data = await store.read();
      const lookup = resolveActiveSeasonForParticipant(data, me!.email);
      if (!lookup.ok || !lookup.season) {
        return { season: null, failureMessage: describeLookupFailure(lookup.failure) };
      }
      const season = lookup.season;
      const report = buildSeasonReport(data, season);
      const pickTarget = openTournament(data, season.id);
      const golferName = (id: string) => data.golfers.find((g) => g.id === id)?.name ?? id;
      const seasonPicksList = seasonPicks(data, season.id);
      const rosterIds = seasonRoster(data, season.id).map((p) => p.id);

      // Already used this season -> which tournament, so the pick page can
      // say where (a tournament being previewed here doesn't count as
      // "used" for itself — if you already have a pick there, that's your
      // current selection, not a blocked one). One-and-done guarantees at
      // most one prior tournament per golfer per participant.
      const usedInTournamentByGolfer = new Map<string, string>();
      for (const p of data.picks) {
        if (p.participantId !== me!.id || p.seasonId !== season.id) continue;
        usedInTournamentByGolfer.set(p.golferId, p.tournamentId);
      }

      const myOverallEarnings = report.seasonStandings.find((r) => r.participantId === me!.id)?.totalEarnings ?? 0;
      const aheadOverallIds = report.seasonStandings
        .filter((r) => r.totalEarnings > myOverallEarnings)
        .map((r) => r.participantId);

      const quarterPillFor = (t: (typeof data.tournaments)[number]) => {
        if (t.isSeasonFinale) return "finale";
        const b = report.quarterBoundaries.find((b) => b.quarter < 4 && b.lastSequence === t.sequence);
        return b ? `last of Q${b.quarter}` : null;
      };

      // Every tournament from the currently-open one onward — the pick page
      // shows this week plus however many near-future weeks already have a
      // field set (DataGolf/admin hasn't confirmed fields further out, so
      // there'd be nothing to show or pick from). Past tournaments are never
      // included here; that history lives on the Standings tab/Schedule.
      const upcoming = pickTarget ? data.tournaments.filter((t) => t.seasonId === season.id && t.sequence >= pickTarget.sequence).sort((a, b) => a.sequence - b.sequence) : [];

      const upcomingTournaments = [];
      for (const t of upcoming) {
        const fieldIds = [...tournamentField(data, t.id)];
        const existingPick = seasonPicksList.find((p) => p.participantId === me!.id && p.tournamentId === t.id);
        const thisQuarter = report.quarterBoundaries.find((b) => t.sequence >= b.firstSequence && t.sequence <= b.lastSequence);
        const base = {
          id: t.id,
          name: t.name,
          startTime: t.startTime,
          sequence: t.sequence,
          isSeasonFinale: t.isSeasonFinale,
          quarterPill: quarterPillFor(t),
          quarterNumber: thisQuarter?.quarter ?? null,
          hasField: fieldIds.length > 0,
          existingPickGolferName: existingPick ? golferName(existingPick.golferId) : null,
          field: [] as unknown[],
        };
        if (fieldIds.length === 0) {
          upcomingTournaments.push(base);
          continue;
        }

        const odds = oddsCache ? oddsForTournament(await oddsCache.get(), t.name) : null;

        const quarterStandings = thisQuarter ? report.quarterStandings[thisQuarter.quarter] ?? [] : [];
        const myQuarterEarnings = quarterStandings.find((r) => r.participantId === me!.id)?.totalEarnings ?? 0;
        const aheadQuarterIds = quarterStandings.filter((r) => r.totalEarnings > myQuarterEarnings).map((r) => r.participantId);

        const rosterAvailability = computeGolferAvailability(seasonPicksList, rosterIds, t.id);
        const aheadOverallAvailability = computeGolferAvailability(seasonPicksList, aheadOverallIds, t.id);
        const aheadQuarterAvailability = thisQuarter ? computeGolferAvailability(seasonPicksList, aheadQuarterIds, t.id) : new Map();

        const form = t.externalEventId && golferFormCache ? await golferFormCache.get(Number(t.externalEventId)) : null;

        base.field = fieldIds
          .map((id) => {
            const name = golferName(id);
            const usedTournamentId = usedInTournamentByGolfer.get(id);
            const usedInTournament =
              usedTournamentId && usedTournamentId !== t.id
                ? data.tournaments.find((tt) => tt.id === usedTournamentId)?.name ?? usedTournamentId
                : null;
            return {
              name,
              odds: odds?.get(name) ?? null,
              usedInTournament,
              availability: getAvailability(rosterAvailability, id, rosterIds.length),
              aheadOverallAvailability: getAvailability(aheadOverallAvailability, id, aheadOverallIds.length),
              aheadQuarterAvailability: thisQuarter ? getAvailability(aheadQuarterAvailability, id, aheadQuarterIds.length) : null,
              recentStarts: form?.recentStarts.get(name) ?? [],
              courseHistory: form?.courseHistory.get(name) ?? [],
            };
          })
          .sort((a, b) => a.name.localeCompare(b.name));
        upcomingTournaments.push(base);
      }

      // The Hearn list is a season-long fallback, not scoped to one week —
      // its picker draws from the whole PGA Tour roster, not just whoever's
      // in this week's field. Always includes this week's field too, in
      // case someone's playing but not yet in the ranked player list (e.g.
      // a Monday qualifier).
      const currentOdds = pickTarget && oddsCache ? oddsForTournament(await oddsCache.get(), pickTarget.name) : null;
      const pgaTourPlayers = playerListCache ? await playerListCache.get() : null;
      const hearnPool = new Map<string, number | null>();
      for (const p of pgaTourPlayers ?? []) hearnPool.set(p.name, currentOdds?.get(p.name) ?? null);
      if (pickTarget) {
        for (const id of tournamentField(data, pickTarget.id)) {
          const name = golferName(id);
          if (!hearnPool.has(name)) hearnPool.set(name, currentOdds?.get(name) ?? null);
        }
      }

      return {
        season,
        upcomingTournaments,
        hearnPool: [...hearnPool.entries()]
          .map(([name, oddsValue]) => ({ name, odds: oddsValue }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        myPicks: seasonPicks(data, season.id)
          .filter((p) => p.participantId === me!.id)
          .map((p) => ({
            ...p,
            golferName: golferName(p.golferId),
            tournamentName: data.tournaments.find((t) => t.id === p.tournamentId)?.name ?? p.tournamentId,
          })),
        hearnList: data.hearnPicks
          .filter((h) => h.seasonId === season.id && h.participantId === me!.id)
          .sort((a, b) => a.rank - b.rank)
          .map((h) => ({ ...h, golferName: golferName(h.golferId) })),
        report: { ...report, nameByParticipantId: Object.fromEntries(report.nameByParticipantId) },
        tournaments: seasonTournaments(data, season.id),
      };
    },
  },
  {
    /**
     * Submits (or changes) the caller's own pick for a given tournament —
     * same validation as the admin path. tournamentId is explicit rather
     * than inferred, so a stale page doesn't submit against the wrong week;
     * validatePick still re-checks the deadline against the real tournament
     * regardless of what the client thinks is "current."
     */
    method: "POST",
    pattern: /^\/api\/my\/pick$/,
    auth: "auth",
    handler: async ({ me, body, store }) => {
      const data = await store.read();
      const lookup = resolveActiveSeasonForParticipant(data, me!.email);
      if (!lookup.ok || !lookup.season) throw new HttpError(400, describeLookupFailure(lookup.failure));

      const tournamentId = String(body.tournamentId ?? "");
      const result = executeCommand(
        data,
        me!,
        lookup.season,
        { command: "PICK", tournamentId, golferName: String(body.golferName ?? "") },
        new Date()
      );
      if (result.pickToRecord) {
        const pickToRecord = result.pickToRecord;
        await store.update((d) => {
          d.picks = d.picks.filter(
            (p) => !(p.participantId === pickToRecord.participantId && p.tournamentId === pickToRecord.tournamentId)
          );
          d.picks.push(pickToRecord);
        });
      }
      return { ok: Boolean(result.pickToRecord), message: result.replyText };
    },
  },
  {
    /** Replaces the caller's own Hearn list for their current season. */
    method: "PUT",
    pattern: /^\/api\/my\/hearn$/,
    auth: "auth",
    handler: async ({ me, body, store }) => {
      const data = await store.read();
      const lookup = resolveActiveSeasonForParticipant(data, me!.email);
      if (!lookup.ok || !lookup.season) throw new HttpError(400, describeLookupFailure(lookup.failure));
      const seasonId = lookup.season.id;
      const names = (body.golferNames as string[]) ?? [];

      await store.update((d) => {
        d.hearnPicks = d.hearnPicks.filter(
          (h) => !(h.seasonId === seasonId && h.participantId === me!.id)
        );
        names
          .map((n) => n.trim())
          .filter((n) => n.length > 0)
          .forEach((name, i) => {
            const golfer = upsertGolfer(d, name);
            d.hearnPicks.push({ seasonId, participantId: me!.id, golferId: golfer.id, rank: i + 1 });
          });
      });
      return { ok: true, count: names.length };
    },
  },
  {
    /** Sets the caller's own display nickname, shown to other participants instead of their name. */
    method: "PUT",
    pattern: /^\/api\/my\/nickname$/,
    auth: "auth",
    handler: async ({ me, body, store }) => {
      const nickname = String(body.nickname ?? "").trim();
      await store.update((d) => {
        const participant = d.participants.find((p) => p.id === me!.id);
        if (participant) participant.nickname = nickname.length > 0 ? nickname : null;
      });
      return { ok: true, nickname: nickname.length > 0 ? nickname : null };
    },
  },
  {
    /**
     * Self-service password change while already logged in — the only other
     * path today is the "forgot password" email-link flow, which requires
     * logging out first. Re-issues the session cookie afterward (changing
     * passwordSetAt invalidates every previously-signed cookie, this
     * request's included) so the caller doesn't get logged out by their own change.
     */
    method: "PUT",
    pattern: /^\/api\/my\/password$/,
    auth: "auth",
    handler: async ({ me, body, store, setCookie }) => {
      const currentPassword = String(body.currentPassword ?? "");
      const newPassword = String(body.newPassword ?? "");
      if (newPassword.length < 8) throw new HttpError(400, "New password must be at least 8 characters");
      if (!me!.passwordHash || !verifyPassword(currentPassword, me!.passwordHash)) {
        throw new HttpError(401, "Current password is incorrect");
      }

      const passwordSetAt = new Date().toISOString();
      const passwordHash = hashPassword(newPassword);
      let updated: Participant | undefined;
      await store.update((d) => {
        const p = d.participants.find((x) => x.id === me!.id);
        if (!p) return;
        p.passwordHash = passwordHash;
        p.passwordSetAt = passwordSetAt;
        updated = p;
      });
      if (!updated) throw new HttpError(404, "Participant not found");
      setCookie(updated);
      return { ok: true };
    },
  },

  // ---- overview (admin) -------------------------------------------------------
  {
    method: "GET",
    pattern: /^\/api\/state$/,
    auth: "admin",
    handler: async ({ store }) => {
      const data = await store.read();
      return {
        leagues: data.leagues,
        seasons: data.seasons,
        participants: data.participants,
        golferCount: data.golfers.length,
      };
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/seasons\/([^/]+)\/report$/,
    auth: "admin",
    handler: async ({ params, store }) => {
      const data = await store.read();
      const season = requireSeason(data, params[0]!);
      const report = buildSeasonReport(data, season);
      const tournaments = seasonTournaments(data, season.id);
      return {
        ...report,
        nameByParticipantId: Object.fromEntries(report.nameByParticipantId),
        roster: seasonRoster(data, season.id),
        toccMembers: data.seasonEntries.filter((e) => e.seasonId === season.id && e.isTOCCMember),
        tournaments,
        // The admin Emails tab defaults its tournament pickers to this one.
        openTournamentId: openTournament(data, season.id)?.id ?? null,
        // Tournament id -> field golfer names, for the admin pick-override dropdown.
        fields: Object.fromEntries(
          tournaments.map((t) => [t.id, [...tournamentField(data, t.id)].map((gid) => golferName(data, gid)).sort()])
        ),
        // Every golfer known to the app, for the admin Hearn-pick dropdown (a season-long list, not this week's field).
        golfers: data.golfers.map((g) => g.name).sort(),
      };
    },
  },
  {
    /**
     * Lists every pick for a season. Golfer identity is withheld (name and
     * id both) for any tournament that hasn't started yet — the admin here
     * is also a participant, so this is the one place that would otherwise
     * let them see the field before making (or being locked into) their own
     * pick. "Selected" just confirms a pick exists; who it's for stays
     * hidden until the same deadline everyone else is bound by has passed.
     */
    method: "GET",
    pattern: /^\/api\/seasons\/([^/]+)\/picks$/,
    auth: "admin",
    handler: async ({ params, store }) => {
      const data = await store.read();
      const picks = seasonPicks(data, params[0]!);
      const now = Date.now();
      return picks.map((p) => {
        const tournament = data.tournaments.find((t) => t.id === p.tournamentId);
        const locked = !tournament || new Date(tournament.startTime).getTime() > now;
        return {
          ...p,
          golferId: locked ? null : p.golferId,
          golferName: locked ? "Selected" : (data.golfers.find((g) => g.id === p.golferId)?.name ?? p.golferId),
          participantName: data.participants.find((x) => x.id === p.participantId)?.name,
        };
      });
    },
  },

  // ---- league & season lifecycle (admin) --------------------------------------
  {
    method: "POST",
    pattern: /^\/api\/leagues$/,
    auth: "admin",
    handler: async ({ body, store }) => {
      const league = {
        id: `lg-${randomUUID().slice(0, 8)}`,
        name: String(body.name ?? "League"),
        isTest: Boolean(body.isTest),
        createdAt: new Date().toISOString(),
      };
      await store.update((d) => void d.leagues.push(league));
      return league;
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/seasons$/,
    auth: "admin",
    handler: async ({ body, store }) => {
      const season = createSeason({
        id: `sn-${randomUUID().slice(0, 8)}`,
        leagueId: String(body.leagueId),
        year: Number(body.year),
        startDate: body.startDate ? String(body.startDate) : undefined,
        rules: (body.rules as Record<string, number>) ?? undefined,
      });
      await store.update((d) => void d.seasons.push(season));
      return season;
    },
  },
  {
    /** Spins up a test league running from today through the end of this year. */
    method: "POST",
    pattern: /^\/api\/test-league$/,
    auth: "admin",
    handler: async ({ body, store }) => {
      const { league, season } = createTestLeague(
        `lg-${randomUUID().slice(0, 8)}`,
        `sn-${randomUUID().slice(0, 8)}`,
        new Date(),
        (body.rules as Record<string, number>) ?? undefined
      );
      season.status = "ACTIVE";

      // Optionally clone the roster of an existing season so it's usable immediately.
      const copyFrom = body.copyRosterFromSeasonId ? String(body.copyRosterFromSeasonId) : null;
      await store.update((d) => {
        d.leagues.push(league);
        d.seasons.push(season);
        if (copyFrom) {
          for (const entry of d.seasonEntries.filter((e) => e.seasonId === copyFrom)) {
            d.seasonEntries.push({ ...entry, seasonId: season.id });
          }
        }
      });
      return { league, season };
    },
  },
  {
    /** Rolls a league into a new year, carrying the roster, keeping old seasons intact. */
    method: "POST",
    pattern: /^\/api\/seasons\/([^/]+)\/roll-over$/,
    auth: "admin",
    handler: async ({ params, body, store }) => {
      const data = await store.read();
      const previous = requireSeason(data, params[0]!);
      const roster = data.seasonEntries.filter((e) => e.seasonId === previous.id);
      const { season, entries } = startNewSeason(
        previous,
        `sn-${randomUUID().slice(0, 8)}`,
        Number(body.year ?? previous.year + 1),
        roster
      );
      await store.update((d) => {
        d.seasons.push(season);
        d.seasonEntries.push(...entries);
      });
      return { season, entries };
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/seasons\/([^/]+)\/status$/,
    auth: "admin",
    handler: async ({ params, body, store }) => {
      const status = String(body.status);
      if (!["DRAFT", "ACTIVE", "COMPLETE"].includes(status)) {
        throw new HttpError(400, "status must be DRAFT, ACTIVE or COMPLETE");
      }
      await store.update((d) => {
        const season = requireSeason(d, params[0]!);
        season.status = status as Season["status"];
      });
      return { ok: true };
    },
  },
  {
    /**
     * Updates any subset of a season's dollar rules — Greller/Side
     * Pot/TOCC settings plus buyIn and the overall/quarter payout
     * schedules. overallPayouts/quarterPayouts are sent as {place, pct}
     * pairs (pct = a fraction of buyIn * roster size); the client converts
     * whatever dollar amounts an admin types into that ratio using the
     * roster size visible at save time, so the schedule itself stays a
     * pure ratio that automatically rescales if the roster size changes.
     */
    method: "PUT",
    pattern: /^\/api\/seasons\/([^/]+)\/rules$/,
    auth: "admin",
    handler: async ({ params, body, store }) => {
      const rules: Record<string, unknown> = {};
      for (const key of ["grellerWeeklyContribution", "missedCutFine", "toccStake", "toccStakeIfWinner", "buyIn"]) {
        if (body[key] !== undefined) rules[key] = Number(body[key]);
      }
      for (const key of ["overallPayouts", "quarterPayouts"]) {
        if (body[key] === undefined) continue;
        rules[key] = (body[key] as { place: unknown; pct: unknown }[]).map((p) => ({
          place: Number(p.place),
          pct: Number(p.pct),
        }));
      }
      await store.update((d) => {
        const season = requireSeason(d, params[0]!);
        Object.assign(season, rules);
      });
      return { ok: true };
    },
  },

  // ---- roster (admin) ----------------------------------------------------------
  {
    /** Adds a participant and emails them a link to set their password. */
    method: "POST",
    pattern: /^\/api\/participants$/,
    auth: "admin",
    handler: async ({ body, store, baseUrl, sendMail }) => {
      const nickname = body.nickname ? String(body.nickname).trim() : "";
      const participant: Participant = {
        id: `p-${randomUUID().slice(0, 8)}`,
        name: String(body.name),
        nickname: nickname.length > 0 ? nickname : null,
        email: String(body.email).toLowerCase(),
        isAdmin: false,
        passwordHash: null,
        passwordSetAt: null,
      };
      await store.update((d) => {
        if (d.participants.some((p) => p.email === participant.email)) {
          throw new HttpError(409, `${participant.email} is already a participant`);
        }
        d.participants.push(participant);
      });
      await issuePasswordEmail(store, sendMail, baseUrl, participant);
      return participant;
    },
  },
  {
    /** Admin override of any participant's nickname (self-service is /api/my/nickname). */
    method: "PUT",
    pattern: /^\/api\/participants\/([^/]+)\/nickname$/,
    auth: "admin",
    handler: async ({ params, body, store }) => {
      const nickname = String(body.nickname ?? "").trim();
      await store.update((d) => {
        const participant = d.participants.find((p) => p.id === params[0]!);
        if (!participant) throw new HttpError(404, `No participant ${params[0]}`);
        participant.nickname = nickname.length > 0 ? nickname : null;
      });
      return { ok: true, nickname: nickname.length > 0 ? nickname : null };
    },
  },
  {
    /** Admin edit of a participant's name/email. Doesn't touch their password. */
    method: "PUT",
    pattern: /^\/api\/participants\/([^/]+)$/,
    auth: "admin",
    handler: async ({ params, body, store }) => {
      const name = body.name !== undefined ? String(body.name).trim() : undefined;
      const email = body.email !== undefined ? String(body.email).trim().toLowerCase() : undefined;
      if (name !== undefined && name.length === 0) throw new HttpError(400, "Name can't be empty");
      if (email !== undefined && email.length === 0) throw new HttpError(400, "Email can't be empty");

      await store.update((d) => {
        const participant = d.participants.find((p) => p.id === params[0]!);
        if (!participant) throw new HttpError(404, `No participant ${params[0]}`);
        if (email !== undefined && d.participants.some((p) => p.id !== participant.id && p.email === email)) {
          throw new HttpError(409, `${email} is already a participant`);
        }
        if (name !== undefined) participant.name = name;
        if (email !== undefined) participant.email = email;
      });
      return { ok: true };
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/seasons\/([^/]+)\/roster$/,
    auth: "admin",
    handler: async ({ params, body, store }) => {
      const seasonId = params[0]!;
      const participantId = String(body.participantId);
      const isTOCCMember = Boolean(body.isTOCCMember);
      await store.update((d) => {
        requireSeason(d, seasonId);
        const existing = d.seasonEntries.find(
          (e) => e.seasonId === seasonId && e.participantId === participantId
        );
        if (existing) existing.isTOCCMember = isTOCCMember;
        else d.seasonEntries.push({ seasonId, participantId, isTOCCMember });
      });
      return { ok: true };
    },
  },

  // ---- Hearn picks (admin) -------------------------------------------------------
  {
    method: "GET",
    pattern: /^\/api\/seasons\/([^/]+)\/hearn$/,
    auth: "admin",
    handler: async ({ params, store }) => {
      const data = await store.read();
      const seasonId = params[0]!;
      const dead = new Set(
        findDeadHearnEntries(seasonId, data.hearnPicks, data.picks).map(
          (h) => `${h.participantId}:${h.golferId}`
        )
      );
      return data.hearnPicks
        .filter((h) => h.seasonId === seasonId)
        .sort((a, b) => a.participantId.localeCompare(b.participantId) || a.rank - b.rank)
        .map((h) => ({
          ...h,
          golferName: data.golfers.find((g) => g.id === h.golferId)?.name ?? h.golferId,
          isDead: dead.has(`${h.participantId}:${h.golferId}`),
        }));
    },
  },
  {
    /** Replaces a participant's whole Hearn list for a season, in the order given. */
    method: "PUT",
    pattern: /^\/api\/seasons\/([^/]+)\/hearn\/([^/]+)$/,
    auth: "admin",
    handler: async ({ params, body, store }) => {
      const [seasonId, participantId] = [params[0]!, params[1]!];
      const names = (body.golferNames as string[]) ?? [];
      await store.update((d) => {
        requireSeason(d, seasonId);
        d.hearnPicks = d.hearnPicks.filter(
          (h) => !(h.seasonId === seasonId && h.participantId === participantId)
        );
        names
          .map((n) => n.trim())
          .filter((n) => n.length > 0)
          .forEach((name, i) => {
            const golfer = upsertGolfer(d, name);
            d.hearnPicks.push({ seasonId, participantId, golferId: golfer.id, rank: i + 1 });
          });
      });
      return { ok: true, count: names.length };
    },
  },

  // ---- schedule, field, results (admin) -------------------------------------------
  {
    method: "POST",
    pattern: /^\/api\/tournaments$/,
    auth: "admin",
    handler: async ({ body, store }) => {
      const data = await store.read();
      const seasonId = String(body.seasonId);
      const existing = seasonTournaments(data, seasonId);
      const tournament = {
        id: `t-${randomUUID().slice(0, 8)}`,
        seasonId,
        name: String(body.name),
        sequence: Number(body.sequence ?? existing.length + 1),
        startTime: new Date(String(body.startTime)).toISOString(),
        isSeasonFinale: Boolean(body.isSeasonFinale),
        externalEventId: body.externalEventId ? String(body.externalEventId) : undefined,
      };
      await store.update((d) => void d.tournaments.push(tournament));
      return tournament;
    },
  },
  {
    /**
     * Edits an existing tournament — most commonly `startTime`, since that
     * doubles as the pick deadline and the seed script (scripts/seed-
     * schedule.mjs) only has DataGolf's date-only schedule to work with, so
     * it fills in a conservative 10:00 UTC placeholder rather than the real
     * tee time. Only the fields present in the body are changed.
     */
    method: "PUT",
    pattern: /^\/api\/tournaments\/([^/]+)$/,
    auth: "admin",
    handler: async ({ params, body, store }) => {
      const tournamentId = params[0]!;
      let updated;
      await store.update((d) => {
        const tournament = d.tournaments.find((t) => t.id === tournamentId);
        if (!tournament) throw new HttpError(404, `No tournament ${tournamentId}`);
        if (body.name !== undefined) tournament.name = String(body.name);
        if (body.startTime !== undefined) tournament.startTime = new Date(String(body.startTime)).toISOString();
        if (body.sequence !== undefined) tournament.sequence = Number(body.sequence);
        if (body.isSeasonFinale !== undefined) tournament.isSeasonFinale = Boolean(body.isSeasonFinale);
        updated = tournament;
      });
      return updated;
    },
  },
  {
    /** Removes a tournament that hasn't been picked yet — e.g. to undo a bad seed/import. */
    method: "DELETE",
    pattern: /^\/api\/tournaments\/([^/]+)$/,
    auth: "admin",
    handler: async ({ params, store }) => {
      const tournamentId = params[0]!;
      await store.update((d) => {
        if (d.picks.some((p) => p.tournamentId === tournamentId)) {
          throw new HttpError(409, "Can't delete a tournament that already has picks recorded.");
        }
        d.tournaments = d.tournaments.filter((t) => t.id !== tournamentId);
        d.results = d.results.filter((r) => r.tournamentId !== tournamentId);
        delete d.fields[tournamentId];
      });
      return { ok: true };
    },
  },
  {
    /** Sets this week's field from a newline/comma separated list of golfer names. */
    method: "PUT",
    pattern: /^\/api\/tournaments\/([^/]+)\/field$/,
    auth: "admin",
    handler: async ({ params, body, store }) => {
      const tournamentId = params[0]!;
      const names = (body.golferNames as string[]) ?? [];
      let count = 0;
      await store.update((d) => {
        const ids = names
          .map((n) => n.trim())
          .filter((n) => n.length > 0)
          .map((n) => upsertGolfer(d, n).id);
        d.fields[tournamentId] = [...new Set(ids)];
        count = d.fields[tournamentId]!.length;
      });
      return { ok: true, fieldSize: count };
    },
  },
  {
    /**
     * Posts results for a tournament. Accepts rows of
     * { golferName, earnings, finishPosition } — finishPosition null/absent
     * means missed the cut, which triggers the Side Pot fine.
     */
    method: "PUT",
    pattern: /^\/api\/tournaments\/([^/]+)\/results$/,
    auth: "admin",
    handler: async ({ params, body, store, sendMail }) => {
      const tournamentId = params[0]!;
      const rawRows = (body.results as Record<string, unknown>[]) ?? [];
      const rows: ResultRow[] = rawRows.map((row) => ({
        golferName: String(row.golferName),
        earnings: Number(row.earnings ?? 0),
        finishPosition:
          row.finishPosition === null || row.finishPosition === undefined || row.finishPosition === ""
            ? null
            : Number(row.finishPosition),
      }));
      const count = await applyResults(store, tournamentId, rows, sendMail);
      return { ok: true, count };
    },
  },

  // ---- picks (admin) ---------------------------------------------------------------
  {
    /** Admin pick entry/override. Runs the same validation as a self-service pick. */
    method: "POST",
    pattern: /^\/api\/picks$/,
    auth: "admin",
    handler: async ({ body, store }) => {
      const data = await store.read();
      const tournamentId = String(body.tournamentId);
      const tournament = data.tournaments.find((t) => t.id === tournamentId);
      if (!tournament) throw new HttpError(404, `No tournament ${tournamentId}`);

      const golfer = findGolferByName(data, String(body.golferName));
      if (!golfer) throw new HttpError(404, `No golfer matching "${body.golferName}"`);

      const participantId = String(body.participantId);
      const force = Boolean(body.force);

      // This entry replaces any pick the participant already has for this
      // week, so that pick must not count against them — but every OTHER
      // week still does, which is what keeps one-and-done intact.
      const priorPicks = data.picks.filter(
        (p) => !(p.participantId === participantId && p.tournamentId === tournamentId)
      );

      const validation = validatePick({
        participantId,
        seasonId: tournament.seasonId,
        tournamentId,
        golferId: golfer.id,
        receivedAt: new Date().toISOString(),
        tournamentStartTime: tournament.startTime,
        existingPicks: priorPicks,
        tournamentField: tournamentField(data, tournamentId),
      });

      // An admin may override the deadline or a thin field. One-and-done is
      // never overridable, so it survives `force` here.
      const blocking = blockingReasons(validation, force);
      if (blocking.length > 0) throw new HttpError(400, blocking.join(", "));

      await store.update((d) => {
        d.picks = d.picks.filter(
          (p) => !(p.participantId === participantId && p.tournamentId === tournamentId)
        );
        d.picks.push({
          participantId,
          seasonId: tournament.seasonId,
          tournamentId,
          golferId: golfer.id,
          submittedAt: new Date().toISOString(),
          source: "admin",
        });
      });
      return { ok: true, golfer };
    },
  },
  {
    /** Fills in missing picks from Hearn lists. Dry run unless commit=true. */
    method: "POST",
    pattern: /^\/api\/tournaments\/([^/]+)\/run-hearn$/,
    auth: "admin",
    handler: async ({ params, body, store }) => {
      const data = await store.read();
      const tournamentId = params[0]!;
      const tournament = data.tournaments.find((t) => t.id === tournamentId);
      if (!tournament) throw new HttpError(404, `No tournament ${tournamentId}`);

      const result = applyHearnFallbacks({
        seasonId: tournament.seasonId,
        tournamentId,
        participantIds: seasonRoster(data, tournament.seasonId).map((p) => p.id),
        hearnLists: data.hearnPicks,
        existingPicks: data.picks,
        tournamentField: tournamentField(data, tournamentId),
        assignedAt: tournament.startTime,
      });

      if (body.commit) {
        await store.update((d) => void d.picks.push(...result.picks));
      }

      const nameOf = (id: string) => data.golfers.find((g) => g.id === id)?.name ?? id;
      return {
        committed: Boolean(body.commit),
        assigned: result.picks.map((p) => ({
          participantName: data.participants.find((x) => x.id === p.participantId)?.name,
          golferName: nameOf(p.golferId),
        })),
        unresolved: result.unresolved.map(
          (id) => data.participants.find((p) => p.id === id)?.name ?? id
        ),
        resolutions: result.resolutions.map((r) => ({
          participantName: data.participants.find((p) => p.id === r.participantId)?.name,
          evaluated: r.evaluated.map((e) => ({ ...e, golferName: nameOf(e.golferId) })),
        })),
      };
    },
  },

  // ---- service emails (admin) -------------------------------------------------
  {
    /**
     * Manually fires one of the service emails for a specific tournament,
     * right now — for testing, rehearsal, or catching up on one that never
     * fired automatically. PICK_REMINDER/PICKS_DIGEST/TOCC_PICKS_ANNOUNCEMENT
     * go through the exact same send+dedupe functions the automatic sweep
     * uses (jobs/notifications.js), so a manual send correctly stops the
     * sweep from also sending it. RESULTS_DIGEST just re-runs the same
     * event-driven digest the results-posting route already sends.
     * TOCC_ROUND_UPDATE is the one exception: it deliberately does NOT write
     * a dedupe record, because jobs/toccLive.ts's automatic sweep tracks
     * "highest round already sent" to decide what's next — a manual send at
     * the wrong round would desync that and skip a real round's email. It
     * always reports whatever round DataGolf's live feed currently has,
     * ignoring whether that round has actually finished.
     */
    method: "POST",
    pattern: /^\/api\/admin\/emails\/send$/,
    auth: "admin",
    handler: async ({ body, store, sendMail, baseUrl, dataGolfApiKey }) => {
      const type = String(body.type ?? "");
      const tournamentId = String(body.tournamentId ?? "");
      const data = await store.read();
      const tournament = data.tournaments.find((t) => t.id === tournamentId);
      if (!tournament) throw new HttpError(404, `No tournament ${tournamentId}`);
      const season = data.seasons.find((s) => s.id === tournament.seasonId);
      if (!season) throw new HttpError(404, `No season for tournament ${tournamentId}`);

      switch (type) {
        case "PICK_REMINDER": {
          const sent = await sendPickRemindersNow(store, sendMail, baseUrl, data, season, tournament);
          return { sent };
        }
        case "PICKS_DIGEST": {
          const sent = await sendPicksDigestFor(store, sendMail, data, season, tournament);
          return { sent };
        }
        case "TOCC_PICKS_ANNOUNCEMENT": {
          const sent = await sendTOCCPicksAnnouncementFor(store, sendMail, data, season, tournament);
          return { sent };
        }
        case "RESULTS_DIGEST": {
          if (!data.results.some((r) => r.tournamentId === tournament.id)) {
            throw new HttpError(400, "No results posted for this tournament yet");
          }
          await sendResultsDigest(data, tournament.id, sendMail);
          return { sent: seasonRoster(data, season.id).length };
        }
        case "TOCC_ROUND_UPDATE": {
          if (!dataGolfApiKey) throw new HttpError(400, "DATAGOLF_API_KEY isn't configured");
          const toccIds = toccMemberIds(data, season.id);
          const roster = data.participants.filter((p) => toccIds.includes(p.id));
          if (roster.length === 0) throw new HttpError(400, "No TOCC members on this season's roster");

          const live = await fetchLiveInPlay(dataGolfApiKey);
          const scoped = liveDataForTournament(live, tournament.name);
          if (!scoped) throw new HttpError(400, `No live DataGolf data available for "${tournament.name}" right now`);

          const round = Math.min(Math.max(scoped.currentRound, 1), 4);
          const nameByParticipantId = new Map(data.participants.map((p) => [p.id, p.nickname || p.name]));
          const weekPicks = seasonPicks(data, season.id).filter((p) => p.tournamentId === tournament.id);
          const standings = buildTOCCLiveStandings(data, toccIds, weekPicks, scoped.rows);
          const rows = standings.map((s) => ({
            name: nameByParticipantId.get(s.participantId) ?? s.participantId,
            golferName: s.golferName,
            currentPos: s.currentPos,
            currentScore: s.currentScore,
          }));

          let money: { payments: { from: string; to: string; amount: number }[]; seasonNet: Record<string, number>; nameByParticipantId: Map<string, string> } | undefined;
          if (round >= 4) {
            const weekResult = estimateTOCCWeekFromLive(data, toccIds, weekPicks, scoped.rows, tournament.id, {
              stake: season.toccStake,
              stakeIfWinner: season.toccStakeIfWinner,
            });
            const priorReport = buildSeasonReport(data, season);
            const seasonNet: Record<string, number> = { ...priorReport.tocc.netByParticipant };
            for (const payment of weekResult.payments) {
              seasonNet[payment.from] = (seasonNet[payment.from] ?? 0) - payment.amount;
              seasonNet[payment.to] = (seasonNet[payment.to] ?? 0) + payment.amount;
            }
            money = { payments: weekResult.payments, seasonNet, nameByParticipantId };
          }

          const { subject, bodyText, bodyHtml } = renderTOCCRoundUpdateEmail(tournament.name, round, rows, money);
          const recipients = roster.map((p) => p.email).join(", ");
          await sendMail({ to: recipients, subject, bodyText, bodyHtml });
          return { sent: roster.length, round };
        }
        default:
          throw new HttpError(400, `Unknown email type "${type}"`);
      }
    },
  },
  {
    /** Free-text broadcast to some or all of a season's roster. */
    method: "POST",
    pattern: /^\/api\/seasons\/([^/]+)\/broadcast$/,
    auth: "admin",
    handler: async ({ params, body, store, sendMail }) => {
      const data = await store.read();
      const season = requireSeason(data, params[0]!);
      const roster = seasonRoster(data, season.id);

      const requestedIds = Array.isArray(body.participantIds) ? (body.participantIds as unknown[]).map(String) : null;
      const targets = requestedIds && requestedIds.length > 0 ? roster.filter((p) => requestedIds.includes(p.id)) : roster;
      if (targets.length === 0) throw new HttpError(400, "No recipients");

      const subject = String(body.subject ?? "").trim();
      const message = String(body.message ?? "").trim();
      if (!subject || !message) throw new HttpError(400, "Subject and message are required");

      const { bodyText, bodyHtml } = renderBroadcastEmail(subject, message);
      const recipients = targets.map((p) => p.email).join(", ");
      await sendMail({ to: recipients, subject, bodyText, bodyHtml });
      return { sent: targets.length };
    },
  },
];

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "Body must be valid JSON");
  }
}

const SESSION_COOKIE = "session";

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (!key) continue;
    out[key] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function cookieHeader(value: string, maxAgeSeconds: number, secure: boolean): string {
  const attrs = [`${SESSION_COOKIE}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAgeSeconds}`];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}

async function resolveSession(
  req: IncomingMessage,
  store: LeagueStore,
  sessionSecret: string
): Promise<Participant | null> {
  const raw = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!raw) return null;
  const payload = verifySession(raw, sessionSecret);
  if (!payload) return null;

  const data = await store.read();
  const participant = data.participants.find((p) => p.id === payload.participantId);
  if (!participant) return null;
  // Changing your password re-signs every future cookie's embedded
  // passwordSetAt, so a stale one (signed before the change) fails here —
  // this is what invalidates other sessions without a server-side store.
  if ((participant.passwordSetAt ?? null) !== payload.passwordSetAt) return null;
  return participant;
}

let cachedGmailAuth: OAuth2Client | null = null;
async function getMailAuth(stateDir: string): Promise<OAuth2Client> {
  if (!cachedGmailAuth) cachedGmailAuth = await getAuthedClient({ stateDir });
  return cachedGmailAuth;
}

export interface AdminServerOptions {
  store: LeagueStore;
  port?: number;
  /** Bind address. Defaults to 0.0.0.0 so the page is reachable on the LAN/internet. */
  host?: string;
  /** Signs session cookies. Auto-generated (with a warning) if unset — fine for dev, set it in production. */
  sessionSecret?: string;
  /** State dir holding the shared Gmail OAuth token, for password-setup emails. Unset = emails are skipped (logged instead). */
  gmailStateDir?: string;
  /** Enables live win-odds and the full PGA Tour roster (for Hearn) in the pickers. Unset = names only, nothing else affected. */
  dataGolfApiKey?: string;
}

/** Builds the SendMail used both by the HTTP server and the standalone notification sweep (see jobs/notifications.ts). */
export function createSendMail(gmailStateDir?: string): SendMail {
  return async (args) => {
    if (!gmailStateDir) {
      console.warn(`GMAIL_STATE_DIR not configured — skipping email "${args.subject}" to ${args.to}`);
      return;
    }
    const auth = await getMailAuth(gmailStateDir);
    await sendEmail(auth, args);
  };
}

export function createAdminServer(options: AdminServerOptions) {
  const { store, gmailStateDir } = options;
  const sessionSecret = options.sessionSecret ?? randomUUID();
  const secureCookies = process.env.NODE_ENV === "production";
  const oddsCache = options.dataGolfApiKey ? createOddsCache(options.dataGolfApiKey) : null;
  const playerListCache = options.dataGolfApiKey ? createPlayerListCache(options.dataGolfApiKey) : null;
  const golferFormCache = options.dataGolfApiKey ? createGolferFormCache(options.dataGolfApiKey) : null;
  const sendMail = createSendMail(gmailStateDir);

  return createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const baseUrl = `${req.headers["x-forwarded-proto"] ?? "http"}://${req.headers.host ?? "localhost"}`;

      const send = (status: number, payload: unknown, contentType = "application/json") => {
        const body = contentType === "application/json" ? JSON.stringify(payload) : String(payload);
        res.writeHead(status, { "content-type": contentType });
        res.end(body);
      };
      const setCookie = (participant: Participant) => {
        const value = signSession(
          { participantId: participant.id, passwordSetAt: participant.passwordSetAt ?? null },
          sessionSecret
        );
        res.setHeader("Set-Cookie", cookieHeader(value, SESSION_MAX_AGE_MS / 1000, secureCookies));
      };
      const clearCookie = () => {
        res.setHeader("Set-Cookie", cookieHeader("", 0, secureCookies));
      };

      try {
        if (url.pathname === "/" || url.pathname === "/index.html") {
          return send(200, ADMIN_HTML, "text/html; charset=utf-8");
        }

        const route = routes.find((r) => r.method === req.method && r.pattern.test(url.pathname));
        if (!route) return send(404, { error: "Not found" });

        const me = await resolveSession(req, store, sessionSecret);
        if (route.auth === "admin" && !me?.isAdmin) {
          return send(me ? 403 : 401, { error: me ? "Admin access required" : "Unauthorized" });
        }
        if (route.auth === "auth" && !me) {
          return send(401, { error: "Unauthorized" });
        }

        const match = route.pattern.exec(url.pathname)!;
        const result = await route.handler({
          params: match.slice(1),
          body: await readBody(req),
          query: url.searchParams,
          store,
          me,
          baseUrl,
          setCookie,
          clearCookie,
          sendMail,
          oddsCache,
          playerListCache,
          golferFormCache,
          dataGolfApiKey: options.dataGolfApiKey,
        });
        return send(200, result);
      } catch (error) {
        const status = error instanceof HttpError ? error.status : 500;
        const message = error instanceof Error ? error.message : "Unknown error";
        return send(status, { error: message });
      }
    })();
  });
}

export function startAdminServer(options: AdminServerOptions): void {
  const port = options.port ?? 8080;
  const host = options.host ?? "0.0.0.0";
  createAdminServer(options).listen(port, host, () => {
    console.log(`Golf league listening on http://${host}:${port}`);
    if (!options.sessionSecret) {
      console.log("No SESSION_SECRET set — a random one was generated, so logins won't survive a restart. Set one in production.");
    }
    if (!options.gmailStateDir) {
      console.log("No GMAIL_STATE_DIR set — password-setup emails will be logged instead of sent.");
    }
    if (!options.dataGolfApiKey) {
      console.log("No DATAGOLF_API_KEY set — pick/Hearn pickers will show golfer names with no odds.");
    }
  });
}
