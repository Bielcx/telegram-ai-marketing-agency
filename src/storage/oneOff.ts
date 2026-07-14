import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { TaskMemory } from "../agent/state.js";

export class OneOffStore {
  private readonly rootDir: string;

  constructor(dataDir: string) {
    this.rootDir = path.resolve(dataDir, "production");
  }

  async saveTask(task: TaskMemory): Promise<void> {
    const taskDir = await this.ensureTaskDir(task.clientSlug, task.id);
    await writeFile(path.join(taskDir, "content.md"), task.content.trim(), "utf8");
    await writeFile(path.join(taskDir, "summary.md"), task.summary.trim(), "utf8");
    await writeFile(path.join(taskDir, "status.json"), JSON.stringify(task, null, 2), "utf8");
  }

  async saveImage(task: TaskMemory, sourcePath: string): Promise<string> {
    const taskDir = await this.ensureTaskDir(task.clientSlug, task.id);
    const imagesDir = path.join(taskDir, "images");
    await mkdir(imagesDir, { recursive: true });

    const imagePath = path.join(imagesDir, `imagem-v${Date.now()}.png`);
    await copyFile(sourcePath, imagePath);
    task.imagePath = imagePath;
    await this.saveTask(task);

    return imagePath;
  }

  async listTasks(clientSlug: string, limit = 10): Promise<TaskMemory[]> {
    const avulsosDir = path.join(this.rootDir, safeSegment(clientSlug), "avulsos");

    try {
      const entries = await readdir(avulsosDir, { withFileTypes: true });
      const tasks = await Promise.all(
        entries
          .filter((entry) => entry.isDirectory())
          .map(async (entry) => this.readTask(clientSlug, entry.name))
      );

      return tasks
        .filter((task): task is TaskMemory => Boolean(task))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, limit);
    } catch {
      return [];
    }
  }

  async getTaskByPosition(clientSlug: string, position: number): Promise<TaskMemory | null> {
    const tasks = await this.listTasks(clientSlug, Math.max(position, 1));
    return tasks[position - 1] || null;
  }

  getTaskDir(clientSlug: string, taskId: string): string {
    return path.join(this.rootDir, safeSegment(clientSlug), "avulsos", safeSegment(taskId));
  }

  private async ensureTaskDir(clientSlug: string, taskId: string): Promise<string> {
    const taskDir = this.getTaskDir(clientSlug, taskId);
    await mkdir(taskDir, { recursive: true });
    return taskDir;
  }

  private async readTask(clientSlug: string, taskId: string): Promise<TaskMemory | null> {
    try {
      const raw = await readFile(path.join(this.getTaskDir(clientSlug, taskId), "status.json"), "utf8");
      return JSON.parse(raw) as TaskMemory;
    } catch {
      return null;
    }
  }
}

function safeSegment(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

