import { JsonLeagueStore } from "./store/jsonStore.js";
import { startAdminServer } from "./admin/server.js";

/**
 * Entry point for the always-on box: starts the web server (participant
 * self-service + admin) over a JSON-file league database.
 *
 *   LEAGUE_DB=./data/league.json ADMIN_PORT=8080 SESSION_SECRET=pick-a-secret \
 *     GMAIL_STATE_DIR=~/.clawdbot-gmail-worker DATAGOLF_API_KEY=xxxx node dist/index.js
 */
const store = new JsonLeagueStore(process.env.LEAGUE_DB ?? "./data/league.json");

startAdminServer({
  store,
  port: Number(process.env.ADMIN_PORT ?? 8080),
  host: process.env.ADMIN_HOST ?? "0.0.0.0",
  sessionSecret: process.env.SESSION_SECRET,
  gmailStateDir: process.env.GMAIL_STATE_DIR,
  dataGolfApiKey: process.env.DATAGOLF_API_KEY,
});
