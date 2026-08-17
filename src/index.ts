import { JsonLeagueStore } from "./store/jsonStore.js";
import { startAdminServer } from "./admin/server.js";

/**
 * Entry point for the always-on box: starts the LAN admin server over a
 * JSON-file league database.
 *
 *   LEAGUE_DB=./data/league.json ADMIN_PORT=8080 ADMIN_TOKEN=secret node dist/index.js
 */
const store = new JsonLeagueStore(process.env.LEAGUE_DB ?? "./data/league.json");

startAdminServer({
  store,
  port: Number(process.env.ADMIN_PORT ?? 8080),
  host: process.env.ADMIN_HOST ?? "0.0.0.0",
  token: process.env.ADMIN_TOKEN,
});
