import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInitialState, type UserState } from "../agent/state.js";

export class FileSessionStore {
  private readonly sessionsDir: string;

  constructor(dataDir: string) {
    this.sessionsDir = path.resolve(dataDir, "sessions");
  }

  async getState(userId: string): Promise<UserState> {
    await mkdir(this.sessionsDir, { recursive: true });
    const filePath = this.getSessionPath(userId);

    try {
      const raw = await readFile(filePath, "utf8");
      return JSON.parse(raw) as UserState;
    } catch {
      return createInitialState(userId);
    }
  }

  async saveState(state: UserState): Promise<void> {
    await mkdir(this.sessionsDir, { recursive: true });
    await writeFile(this.getSessionPath(state.telegramUserId), JSON.stringify(state, null, 2), "utf8");
  }

  private getSessionPath(userId: string): string {
    const safeUserId = userId.replace(/[^a-zA-Z0-9_-]/g, "_");
    return path.join(this.sessionsDir, `${safeUserId}.json`);
  }
}
