export type AppConfig = {
  telegramBotToken: string;
  openaiApiKey: string;
  openaiTextModel: string;
  openaiResearchModel: string;
  openaiImageModel: string;
  agentKnowledgeDir: string;
  dataDir: string;
  researchMonthlyLimit: number;
};

export function loadConfig(): AppConfig {
  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
  const openaiApiKey = process.env.OPENAI_API_KEY;

  if (!telegramBotToken) {
    throw new Error("Missing TELEGRAM_BOT_TOKEN in environment.");
  }

  if (!openaiApiKey) {
    throw new Error("Missing OPENAI_API_KEY in environment.");
  }

  return {
    telegramBotToken,
    openaiApiKey,
    openaiTextModel: process.env.OPENAI_TEXT_MODEL || "gpt-5.4-mini",
    openaiResearchModel: process.env.OPENAI_RESEARCH_MODEL || process.env.OPENAI_TEXT_MODEL || "gpt-5.4-mini",
    openaiImageModel: process.env.OPENAI_IMAGE_MODEL || "gpt-image-2",
    agentKnowledgeDir: process.env.AGENT_KNOWLEDGE_DIR || "./knowledge",
    dataDir: process.env.DATA_DIR || "./data",
    researchMonthlyLimit: Number(process.env.RESEARCH_MONTHLY_LIMIT || "10")
  };
}

