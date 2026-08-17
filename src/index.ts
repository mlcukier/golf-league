import { JsonLeagueStore } from "./store/jsonStore.js";
import { createSendMail, startAdminServer } from "./admin/server.js";
import { runNotificationSweep } from "./jobs/notifications.js";
import { runResultsPullSweep } from "./jobs/resultsPull.js";

/**
 * Entry point for the always-on box: starts the web server (participant
 * self-service + admin) over a JSON-file league database, plus a recurring
 * sweep for time-based work — pick reminders, Hearn fallback resolution, the
 * post-deadline picks digest (jobs/notifications.ts), and auto-pulling real
 * results from DataGolf once a tournament's finished (jobs/resultsPull.ts).
 * The results digest itself is event-driven, not scheduled — it fires
 * directly off applyResults in admin/server.ts, whether results arrived via
 * that auto-pull or an admin's manual paste.
 *
 *   LEAGUE_DB=./data/league.json ADMIN_PORT=8080 SESSION_SECRET=pick-a-secret \
 *     GMAIL_STATE_DIR=~/.clawdbot-gmail-worker DATAGOLF_API_KEY=xxxx \
 *     APP_BASE_URL=http://192.168.1.94:8080 node dist/index.js
 */
const store = new JsonLeagueStore(process.env.LEAGUE_DB ?? "./data/league.json");
const port = Number(process.env.ADMIN_PORT ?? 8080);
const gmailStateDir = process.env.GMAIL_STATE_DIR;
const dataGolfApiKey = process.env.DATAGOLF_API_KEY;
const appUrl = process.env.APP_BASE_URL ?? `http://localhost:${port}`;
if (!process.env.APP_BASE_URL) {
  console.log(`No APP_BASE_URL set — notification emails will link to ${appUrl}. Set it to your LAN/public address in production.`);
}
if (!dataGolfApiKey) {
  console.log("No DATAGOLF_API_KEY set — results won't be auto-pulled; the admin Results tab still takes pasted results.");
}

startAdminServer({
  store,
  port,
  host: process.env.ADMIN_HOST ?? "0.0.0.0",
  sessionSecret: process.env.SESSION_SECRET,
  gmailStateDir,
  dataGolfApiKey,
});

const SWEEP_INTERVAL_MS = Number(process.env.NOTIFICATION_SWEEP_MINUTES ?? 15) * 60 * 1000;
const sendMail = createSendMail(gmailStateDir);
const sweep = () => {
  void runNotificationSweep(store, sendMail, appUrl).catch((err) => console.error("Notification sweep failed:", err));
  if (dataGolfApiKey) {
    void runResultsPullSweep(store, sendMail, dataGolfApiKey).catch((err) => console.error("Results pull sweep failed:", err));
  }
};
sweep();
setInterval(sweep, SWEEP_INTERVAL_MS);
