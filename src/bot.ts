import { Bot, InputFile } from "grammy";
import type { AppConfig } from "./config.js";
import { createOrchestrator } from "./agent/orchestrator.js";
import { FileSessionStore } from "./storage/filesystem.js";
import { formatTelegramHtml } from "./telegram/format.js";

export function createBot(config: AppConfig): Bot {
  const bot = new Bot(config.telegramBotToken);
  const sessionStore = new FileSessionStore(config.dataDir);
  const orchestrator = createOrchestrator(config, sessionStore);
  const queue = new UserMessageQueue();

  bot.command("start", async (ctx) => {
    await ctx.reply(
      "Oi. Eu sou seu agente de marketing. Pode falar comigo em linguagem natural, por exemplo: \"Quero montar a semana do Cliente Demo com foco em autoridade e conexao.\""
    );
  });

  bot.on("message:text", async (ctx) => {
    const userId = String(ctx.from?.id || "unknown");
    const message = ctx.message.text;
    const wasBusy = queue.isBusy(userId);

    if (wasBusy) {
      await ctx.reply("Estou terminando a etapa anterior. Ja sigo com essa mensagem.");
    }

    await queue.enqueue(userId, async () => {
      const response = await orchestrator.handleMessage(userId, message);

      if (response.showThinking) {
        await ctx.replyWithChatAction("typing");
      }

      for (const chunk of splitTelegramMessage(response.text)) {
        await ctx.reply(formatTelegramHtml(chunk), { parse_mode: "HTML" });
      }

      if (response.photoPath) {
        await ctx.replyWithPhoto(new InputFile(response.photoPath));
      }
    });
  });

  bot.catch((err) => {
    console.error("Bot error:", err);
  });

  return bot;
}

class UserMessageQueue {
  private readonly chains = new Map<string, Promise<void>>();

  isBusy(userId: string): boolean {
    return this.chains.has(userId);
  }

  async enqueue(userId: string, task: () => Promise<void>): Promise<void> {
    const previous = this.chains.get(userId) ?? Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(task)
      .finally(() => {
        if (this.chains.get(userId) === current) {
          this.chains.delete(userId);
        }
      });

    this.chains.set(userId, current);
    return current;
  }
}

function splitTelegramMessage(message: string): string[] {
  const maxLength = 3800;

  if (message.length <= maxLength) {
    return [message];
  }

  const chunks: string[] = [];
  let remaining = message;

  while (remaining.length > maxLength) {
    const splitAt = findSplitPoint(remaining, maxLength);
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}

function findSplitPoint(message: string, maxLength: number): number {
  const candidate = message.slice(0, maxLength);
  return Math.max(
    candidate.lastIndexOf("\n## "),
    candidate.lastIndexOf("\n\n"),
    candidate.lastIndexOf("\n"),
    Math.floor(maxLength * 0.8)
  );
}


