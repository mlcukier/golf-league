#!/usr/bin/env node
/**
 * Bootstraps the first admin account. There's a chicken-and-egg problem
 * otherwise: creating a participant and promoting them to admin both
 * require already being logged in as an admin. This writes directly to the
 * league JSON file instead, so it needs no running server and no build step.
 *
 *   LEAGUE_DB=./data/league.json node scripts/seed-admin.mjs you@example.com 'temporary-password' "Your Name"
 *
 * Uses the same scrypt hash format as src/core/auth.ts (`scrypt$<salt>$<hash>`)
 * so the resulting account logs in normally afterward.
 */
import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const [, , emailArg, passwordArg, nameArg] = process.argv;
if (!emailArg || !passwordArg) {
  console.error("Usage: node scripts/seed-admin.mjs <email> <password> [name]");
  process.exit(1);
}
if (passwordArg.length < 8) {
  console.error("Password must be at least 8 characters.");
  process.exit(1);
}

const email = emailArg.trim().toLowerCase();
const dbPath = process.env.LEAGUE_DB ?? "./data/league.json";

function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

async function readData(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") {
      return {
        leagues: [],
        seasons: [],
        participants: [],
        seasonEntries: [],
        tournaments: [],
        golfers: [],
        picks: [],
        hearnPicks: [],
        results: [],
        fields: {},
        passwordResetTokens: [],
      };
    }
    throw err;
  }
}

async function writeData(path, data) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await rename(tmp, path);
}

const data = await readData(dbPath);
data.participants ??= [];

let participant = data.participants.find((p) => p.email?.toLowerCase() === email);
const passwordHash = hashPassword(passwordArg);
const passwordSetAt = new Date().toISOString();

if (participant) {
  participant.isAdmin = true;
  participant.passwordHash = passwordHash;
  participant.passwordSetAt = passwordSetAt;
  console.log(`Promoted existing participant ${email} to admin and set their password.`);
} else {
  participant = {
    id: `p-${randomUUID().slice(0, 8)}`,
    name: nameArg ?? email.split("@")[0],
    email,
    isAdmin: true,
    passwordHash,
    passwordSetAt,
  };
  data.participants.push(participant);
  console.log(`Created admin participant ${email}.`);
}

await writeData(dbPath, data);
console.log(`Wrote ${dbPath}. Log in at / with ${email} and the password you gave.`);
