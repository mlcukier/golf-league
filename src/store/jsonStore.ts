import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { emptyLeagueData, type LeagueData, type LeagueStore } from "./store.js";

/**
 * JSON-file league store. Writes go through a temp file + rename so a crash
 * mid-write can't truncate the league's history, and concurrent updates are
 * serialized through a promise chain (the admin UI and the weekly cron job
 * both write, and they share one process).
 */
export class JsonLeagueStore implements LeagueStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private filePath: string) {}

  async read(): Promise<LeagueData> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return { ...emptyLeagueData(), ...(JSON.parse(raw) as Partial<LeagueData>) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyLeagueData();
      throw error;
    }
  }

  async update(mutator: (data: LeagueData) => void): Promise<LeagueData> {
    const run = this.queue.then(async () => {
      const data = await this.read();
      mutator(data);
      await this.writeAtomic(data);
      return data;
    });
    // Keep the chain alive even if this update rejects.
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async writeAtomic(data: LeagueData): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
    await rename(tmp, this.filePath);
  }
}

/** In-memory store for tests and dry runs. */
export class MemoryLeagueStore implements LeagueStore {
  constructor(private data: LeagueData = emptyLeagueData()) {}

  async read(): Promise<LeagueData> {
    return this.data;
  }

  async update(mutator: (data: LeagueData) => void): Promise<LeagueData> {
    mutator(this.data);
    return this.data;
  }
}
