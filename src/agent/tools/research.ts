import type { AppConfig } from "../../config.js";
import { loadClientContext } from "../../clients/loader.js";
import { generateTextWithWebSearch } from "../../openai/text.js";
import { buildResearchPrompt } from "../prompts.js";
import { createDefaultResearchState, type UserState } from "../state.js";

export type ResearchResponse = {
  text: string;
  showThinking?: boolean;
};

export async function runResearch(
  config: AppConfig,
  state: UserState,
  clientSlug: string,
  topic: string
): Promise<ResearchResponse> {
  ensureResearchState(state, config.researchMonthlyLimit);

  if (state.research.used >= state.research.monthlyLimit) {
    return {
      text: [
        "Limite mensal de pesquisas atingido.",
        "",
        `Uso atual: ${state.research.used}/${state.research.monthlyLimit}`,
        "Ainda posso produzir com a base fixa e as skills internas, sem pesquisar agora."
      ].join("\n")
    };
  }

  const context = await loadClientContext(config.agentKnowledgeDir, clientSlug);
  const summary = await generateTextWithWebSearch(config, buildResearchPrompt(context, topic));
  state.research.used += 1;
  state.research.lastResearch = {
    clientSlug,
    topic,
    summary,
    createdAt: new Date().toISOString()
  };

  return {
    text: [
      summary,
      "",
      `Pesquisa usada: ${state.research.used}/${state.research.monthlyLimit} neste mes.`
    ].join("\n"),
    showThinking: true
  };
}

export function shouldUseResearch(message: string): boolean {
  const text = normalizeMessage(message);
  if (wantsReuseLastResearch(message)) return false;

  return (
    text.includes("pesquisa") ||
    text.includes("pesquise") ||
    text.includes("pesquisar") ||
    text.includes("referencia") ||
    text.includes("referencias") ||
    text.includes("referência") ||
    text.includes("referências") ||
    text.includes("tendencia") ||
    text.includes("tendencias") ||
    text.includes("tendência") ||
    text.includes("tendências") ||
    text.includes("concorrente") ||
    text.includes("concorrentes") ||
    text.includes("em alta") ||
    text.includes("atual") ||
    text.includes("atuais")
  );
}

export function wantsReuseLastResearch(message: string): boolean {
  const text = normalizeMessage(message);
  return (
    text.includes("essa pesquisa") ||
    text.includes("esta pesquisa") ||
    text.includes("a pesquisa anterior") ||
    text.includes("ultima pesquisa") ||
    text.includes("última pesquisa") ||
    text.includes("com base nisso") ||
    text.includes("com base nela") ||
    text.includes("usando isso") ||
    text.includes("usa isso") ||
    text.includes("use isso") ||
    text.includes("usar isso") ||
    text.includes("usando os insights") ||
    text.includes("usa os insights") ||
    text.includes("use os insights")
  );
}

export function getReusableResearchSummary(state: UserState, clientSlug: string): string | null {
  const lastResearch = state.research?.lastResearch;
  if (!lastResearch) return null;
  if (lastResearch.clientSlug !== clientSlug) return null;

  return lastResearch.summary;
}

export function wantsResearchOnly(message: string): boolean {
  const text = normalizeMessage(message);
  return (
    text.startsWith("pesquisa ") ||
    text.startsWith("pesquise ") ||
    text.startsWith("pesquisar ") ||
    text.includes("faz uma pesquisa") ||
    text.includes("faca uma pesquisa") ||
    text.includes("faça uma pesquisa") ||
    text.includes("busca referencias") ||
    text.includes("buscar referencias")
  );
}

export function wantsResearchStatus(message: string): boolean {
  const text = normalizeMessage(message);
  return (
    text.includes("status pesquisa") ||
    text.includes("status das pesquisas") ||
    text.includes("pesquisas do mes") ||
    text.includes("quantas pesquisas") ||
    text === "pesquisas"
  );
}

export function buildResearchStatusText(state: UserState, monthlyLimit: number): string {
  ensureResearchState(state, monthlyLimit);

  return [
    "Uso de pesquisas:",
    `- mes: ${state.research.monthKey}`,
    `- usadas: ${state.research.used}/${state.research.monthlyLimit}`,
    state.research.lastResearch
      ? `- ultima: ${state.research.lastResearch.topic} (${state.research.lastResearch.clientSlug})`
      : "- ultima: nenhuma"
  ].join("\n");
}

export function ensureResearchState(state: UserState, monthlyLimit: number): void {
  const currentMonth = new Date().toISOString().slice(0, 7);
  state.research ??= createDefaultResearchState();

  if (state.research.monthKey !== currentMonth) {
    state.research.monthKey = currentMonth;
    state.research.used = 0;
    state.research.lastResearch = null;
  }

  state.research.monthlyLimit = monthlyLimit;
}

function normalizeMessage(message: string): string {
  return message
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();
}
