import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type ProductionDayStatus = {
  dayLabel: string;
  copy: "missing" | "draft" | "approved";
  design: "missing" | "draft" | "approved";
  image: "missing" | "draft" | "approved";
  finalImagePath: string | null;
  updatedAt: string;
};

export type ProductionWeekStatus = {
  clientSlug: string;
  weekId: string;
  rootPath: string;
  days: ProductionDayStatus[];
};

export type ProductionApprovalPart = "copy" | "design" | "image" | "post";

export type ProductionApprovalResult = {
  status: ProductionDayStatus;
  approved: Array<Exclude<ProductionApprovalPart, "post">>;
  missing: Array<Exclude<ProductionApprovalPart, "post">>;
};

export class ProductionStore {
  private readonly rootDir: string;

  constructor(dataDir: string) {
    this.rootDir = path.resolve(dataDir, "production");
  }

  getCurrentWeekId(now = new Date()): string {
    const monday = new Date(now);
    const day = monday.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    monday.setDate(monday.getDate() + diff);
    const yyyy = monday.getFullYear();
    const mm = String(monday.getMonth() + 1).padStart(2, "0");
    const dd = String(monday.getDate()).padStart(2, "0");
    return `semana-${yyyy}-${mm}-${dd}`;
  }

  async getLatestWeekId(clientSlug: string): Promise<string | null> {
    const clientDir = path.join(this.rootDir, safeSegment(clientSlug));

    try {
      const entries = await readdir(clientDir, { withFileTypes: true });
      const weekIds = entries
        .filter((entry) => entry.isDirectory() && /^semana-\d{4}-\d{2}-\d{2}$/.test(entry.name))
        .map((entry) => entry.name)
        .sort((a, b) => b.localeCompare(a));

      return weekIds[0] || null;
    } catch {
      return null;
    }
  }

  getProductionRootDir(): string {
    return this.rootDir;
  }

  getClientWeekDir(clientSlug: string, weekId: string): string {
    return this.getWeekDir(clientSlug, weekId);
  }

  async savePlan(clientSlug: string, weekId: string, plan: string): Promise<void> {
    await this.writeWeekFile(clientSlug, weekId, "pauta.md", plan);
  }

  async savePackage(clientSlug: string, weekId: string, copy: string, design: string, review: string, content: string): Promise<void> {
    await this.writeWeekFile(clientSlug, weekId, "copy.md", copy);
    await this.writeWeekFile(clientSlug, weekId, "design.md", design);
    await this.writeWeekFile(clientSlug, weekId, "revisao.md", review);
    await this.writeWeekFile(clientSlug, weekId, "pacote.md", content);
  }

  async saveDaySection(clientSlug: string, weekId: string, dayLabel: string, kind: "copy" | "design", content: string): Promise<void> {
    const dayDir = await this.ensureDayDir(clientSlug, weekId, dayLabel);
    await writeFile(path.join(dayDir, `${kind}.md`), content.trim(), "utf8");

    const status = await this.readDayStatus(clientSlug, weekId, dayLabel);
    status[kind] = "draft";
    status.updatedAt = new Date().toISOString();
    await this.writeDayStatus(clientSlug, weekId, dayLabel, status);
  }

  async saveImageDraft(clientSlug: string, weekId: string, dayLabel: string, sourcePath: string): Promise<string> {
    const dayDir = await this.ensureDayDir(clientSlug, weekId, dayLabel);
    const imagesDir = path.join(dayDir, "images");
    await mkdir(imagesDir, { recursive: true });

    const imagePath = path.join(imagesDir, `imagem-v${Date.now()}.png`);
    await copyFile(sourcePath, imagePath);

    const status = await this.readDayStatus(clientSlug, weekId, dayLabel);
    status.image = "draft";
    status.finalImagePath = imagePath;
    status.updatedAt = new Date().toISOString();
    await this.writeDayStatus(clientSlug, weekId, dayLabel, status);

    return imagePath;
  }

  async approveImage(clientSlug: string, weekId: string, dayLabel: string): Promise<void> {
    const status = await this.readDayStatus(clientSlug, weekId, dayLabel);
    status.image = "approved";
    status.updatedAt = new Date().toISOString();
    await this.writeDayStatus(clientSlug, weekId, dayLabel, status);
  }

  async approveDayPart(
    clientSlug: string,
    weekId: string,
    dayLabel: string,
    part: ProductionApprovalPart
  ): Promise<ProductionApprovalResult> {
    const status = await this.readDayStatus(clientSlug, weekId, dayLabel);
    const approved: ProductionApprovalResult["approved"] = [];
    const missing: ProductionApprovalResult["missing"] = [];

    if (part === "copy" || part === "post") {
      if (status.copy !== "missing") {
        status.copy = "approved";
        approved.push("copy");
      } else {
        missing.push("copy");
      }
    }

    if (part === "design" || part === "post") {
      if (status.design !== "missing") {
        status.design = "approved";
        approved.push("design");
      } else {
        missing.push("design");
      }
    }

    if (part === "image" || part === "post") {
      if (status.image !== "missing") {
        status.image = "approved";
        approved.push("image");
      } else {
        missing.push("image");
      }
    }

    if (approved.length > 0) {
      status.updatedAt = new Date().toISOString();
      await this.writeDayStatus(clientSlug, weekId, dayLabel, status);
    }

    return { status, approved, missing };
  }

  async setImageStatus(
    clientSlug: string,
    weekId: string,
    dayLabel: string,
    imagePath: string,
    imageStatus: "draft" | "approved"
  ): Promise<void> {
    const status = await this.readDayStatus(clientSlug, weekId, dayLabel);
    status.image = imageStatus;
    status.finalImagePath = imagePath;
    status.updatedAt = new Date().toISOString();
    await this.writeDayStatus(clientSlug, weekId, dayLabel, status);
  }

  async getWeekStatus(clientSlug: string, weekId: string): Promise<ProductionWeekStatus> {
    const days = ["Segunda-feira", "Terca-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira"];
    return {
      clientSlug,
      weekId,
      rootPath: this.getWeekDir(clientSlug, weekId),
      days: await Promise.all(days.map((day) => this.readDayStatus(clientSlug, weekId, day)))
    };
  }

  async readDayPackage(clientSlug: string, weekId: string, dayLabel: string): Promise<string | null> {
    const dayDir = this.getDayDir(clientSlug, weekId, dayLabel);
    const parts: string[] = [`# ${dayLabel}`];

    for (const fileName of ["copy.md", "design.md", "status.json"]) {
      try {
        const value = await readFile(path.join(dayDir, fileName), "utf8");
        parts.push(`## ${fileName}`, value.trim());
      } catch {
        // Missing day files are expected before the package is generated.
      }
    }

    return parts.length > 1 ? parts.join("\n\n") : null;
  }

  private async writeWeekFile(clientSlug: string, weekId: string, fileName: string, content: string): Promise<void> {
    const weekDir = await this.ensureWeekDir(clientSlug, weekId);
    await writeFile(path.join(weekDir, fileName), content.trim(), "utf8");
  }

  private async readDayStatus(clientSlug: string, weekId: string, dayLabel: string): Promise<ProductionDayStatus> {
    const statusPath = path.join(this.getDayDir(clientSlug, weekId, dayLabel), "status.json");
    try {
      return JSON.parse(stripByteOrderMark(await readFile(statusPath, "utf8"))) as ProductionDayStatus;
    } catch {
      return {
        dayLabel,
        copy: "missing",
        design: "missing",
        image: "missing",
        finalImagePath: null,
        updatedAt: new Date().toISOString()
      };
    }
  }

  private async writeDayStatus(clientSlug: string, weekId: string, dayLabel: string, status: ProductionDayStatus): Promise<void> {
    const dayDir = await this.ensureDayDir(clientSlug, weekId, dayLabel);
    await writeFile(path.join(dayDir, "status.json"), JSON.stringify(status, null, 2), "utf8");
  }

  private async ensureWeekDir(clientSlug: string, weekId: string): Promise<string> {
    const weekDir = this.getWeekDir(clientSlug, weekId);
    await mkdir(weekDir, { recursive: true });
    return weekDir;
  }

  private async ensureDayDir(clientSlug: string, weekId: string, dayLabel: string): Promise<string> {
    const dayDir = this.getDayDir(clientSlug, weekId, dayLabel);
    await mkdir(dayDir, { recursive: true });
    return dayDir;
  }

  private getWeekDir(clientSlug: string, weekId: string): string {
    return path.join(this.rootDir, safeSegment(clientSlug), safeSegment(weekId));
  }

  private getDayDir(clientSlug: string, weekId: string, dayLabel: string): string {
    return path.join(this.getWeekDir(clientSlug, weekId), dayKey(dayLabel));
  }
}

function dayKey(dayLabel: string): string {
  return safeSegment(dayLabel.replace("-feira", ""));
}

function safeSegment(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function stripByteOrderMark(value: string): string {
  return value.replace(/^\uFEFF/, "");
}
