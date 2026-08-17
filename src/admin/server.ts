import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import type { LeagueStore } from "../store/store.js";
import {
  findGolferByName,
  seasonPicks,
  seasonRoster,
  seasonTournaments,
  tournamentField,
  type LeagueData,
} from "../store/store.js";
import { buildSeasonReport } from "../core/report.js";
import { blockingReasons, validatePick } from "../core/oneAndDone.js";
import { applyHearnFallbacks, findDeadHearnEntries } from "../core/hearn.js";
import { createSeason, createTestLeague, startNewSeason } from "../core/season.js";
import type { Golfer, Season } from "../types.js";
import { ADMIN_HTML } from "./html.js";

interface Route {
  method: string;
  pattern: RegExp;
  handler: (ctx: RouteContext) => Promise<unknown>;
}

interface RouteContext {
  params: string[];
  body: Record<string, unknown>;
  query: URLSearchParams;
  store: LeagueStore;
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

/** Finds an existing golfer by name or creates one, so admin entry is forgiving. */
function upsertGolfer(data: LeagueData, name: string): Golfer {
  const existing = findGolferByName(data, name);
  if (existing) return existing;
  const golfer: Golfer = { id: `g-${randomUUID().slice(0, 8)}`, name: name.trim() };
  data.golfers.push(golfer);
  return golfer;
}

const routes: Route[] = [
  // ---- overview -----------------------------------------------------------
  {
    method: "GET",
    pattern: /^\/api\/state$/,
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
    handler: async ({ params, store }) => {
      const data = await store.read();
      const season = requireSeason(data, params[0]!);
      const report = buildSeasonReport(data, season);
      return {
        ...report,
        nameByParticipantId: Object.fromEntries(report.nameByParticipantId),
        roster: seasonRoster(data, season.id),
        toccMembers: data.seasonEntries.filter((e) => e.seasonId === season.id && e.isTOCCMember),
        tournaments: seasonTournaments(data, season.id),
      };
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/seasons\/([^/]+)\/picks$/,
    handler: async ({ params, store }) => {
      const data = await store.read();
      const picks = seasonPicks(data, params[0]!);
      return picks.map((p) => ({
        ...p,
        golferName: data.golfers.find((g) => g.id === p.golferId)?.name ?? p.golferId,
        participantName: data.participants.find((x) => x.id === p.participantId)?.name,
      }));
    },
  },

  // ---- league & season lifecycle -----------------------------------------
  {
    method: "POST",
    pattern: /^\/api\/leagues$/,
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

  // ---- roster -------------------------------------------------------------
  {
    method: "POST",
    pattern: /^\/api\/participants$/,
    handler: async ({ body, store }) => {
      const participant = {
        id: `p-${randomUUID().slice(0, 8)}`,
        name: String(body.name),
        email: String(body.email).toLowerCase(),
      };
      await store.update((d) => {
        if (d.participants.some((p) => p.email === participant.email)) {
          throw new HttpError(409, `${participant.email} is already a participant`);
        }
        d.participants.push(participant);
      });
      return participant;
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/seasons\/([^/]+)\/roster$/,
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

  // ---- Hearn picks --------------------------------------------------------
  {
    method: "GET",
    pattern: /^\/api\/seasons\/([^/]+)\/hearn$/,
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

  // ---- schedule, field, results ------------------------------------------
  {
    method: "POST",
    pattern: /^\/api\/tournaments$/,
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
    /** Sets this week's field from a newline/comma separated list of golfer names. */
    method: "PUT",
    pattern: /^\/api\/tournaments\/([^/]+)\/field$/,
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
     * means missed the cut, which triggers the Side Pot 1 fine.
     */
    method: "PUT",
    pattern: /^\/api\/tournaments\/([^/]+)\/results$/,
    handler: async ({ params, body, store }) => {
      const tournamentId = params[0]!;
      const rows = (body.results as Record<string, unknown>[]) ?? [];
      await store.update((d) => {
        d.results = d.results.filter((r) => r.tournamentId !== tournamentId);
        for (const row of rows) {
          const golfer = upsertGolfer(d, String(row.golferName));
          const finishPosition =
            row.finishPosition === null || row.finishPosition === undefined || row.finishPosition === ""
              ? null
              : Number(row.finishPosition);
          d.results.push({
            tournamentId,
            golferId: golfer.id,
            earnings: Number(row.earnings ?? 0),
            finishPosition,
            madeCut: finishPosition !== null,
            isWin: finishPosition === 1,
            isTop5: finishPosition !== null && finishPosition <= 5,
            isTop10: finishPosition !== null && finishPosition <= 10,
          });
        }
      });
      return { ok: true, count: rows.length };
    },
  },

  // ---- picks --------------------------------------------------------------
  {
    /** Admin pick entry/override. Runs the same validation as an emailed pick. */
    method: "POST",
    pattern: /^\/api\/picks$/,
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

export interface AdminServerOptions {
  store: LeagueStore;
  port?: number;
  /** Bind address. Defaults to 0.0.0.0 so the page is reachable on the LAN. */
  host?: string;
  /** Optional shared secret; when set, requests need ?token= or X-Admin-Token. */
  token?: string;
}

export function createAdminServer(options: AdminServerOptions) {
  const { store, token } = options;

  return createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

      const send = (status: number, payload: unknown, contentType = "application/json") => {
        const body = contentType === "application/json" ? JSON.stringify(payload) : String(payload);
        res.writeHead(status, { "content-type": contentType });
        res.end(body);
      };

      try {
        if (url.pathname === "/" || url.pathname === "/index.html") {
          return send(200, ADMIN_HTML, "text/html; charset=utf-8");
        }

        if (token) {
          const provided = url.searchParams.get("token") ?? req.headers["x-admin-token"];
          if (provided !== token) return send(401, { error: "Unauthorized" });
        }

        const route = routes.find(
          (r) => r.method === req.method && r.pattern.test(url.pathname)
        );
        if (!route) return send(404, { error: "Not found" });

        const match = route.pattern.exec(url.pathname)!;
        const result = await route.handler({
          params: match.slice(1),
          body: await readBody(req),
          query: url.searchParams,
          store,
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
    console.log(`Golf league admin listening on http://${host}:${port}`);
    if (!options.token) {
      console.log("No ADMIN_TOKEN set — anyone on the LAN can edit. Set one to lock it down.");
    }
  });
}
