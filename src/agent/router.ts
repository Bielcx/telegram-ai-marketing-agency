import type { AppConfig } from "../config.js";
import { generateText } from "../openai/text.js";
import type { ProductionWeekStatus } from "../storage/production.js";
import {
  marketingAgentActionExamples,
  productionApprovalActionParts,
  productionDayLabels,
  type MarketingAgentAction,
  type ProductionDayLabel
} from "./actions.js";
import type { UserState } from "./state.js";

export type RouterAction = MarketingAgentAction;

export async function routeMessageWithAI(
  config: AppConfig,
  message: string,
  state: UserState,
  weekStatus: ProductionWeekStatus
): Promise<RouterAction> {
  const raw = await generateText(config, buildRouterPrompt(message, state, weekStatus));
  return parseRouterAction(raw);
}

function buildRouterPrompt(message: string, state: UserState, weekStatus: ProductionWeekStatus): string {
  return [
    "Voce e um roteador de intencao para um bot de agencia de marketing no Telegram.",
    "Sua tarefa e devolver SOMENTE JSON valido, sem Markdown e sem explicacao.",
    "",
    "Acoes permitidas:",
    ...marketingAgentActionExamples.map((example) => `- ${example}`),
    "",
    "Use action unknown se a mensagem for conversa aberta, pergunta conceitual ou se faltar contexto essencial.",
    "Nao invente dia. Se o usuario disser 'terça', use 'Terca-feira'.",
    "Mapeie texto/legenda/copy para copy. Mapeie visual/layout/design para design. Mapeie capa/imagem para image.",
    "So use generate_image quando o usuario pedir claramente para gerar imagem/capa.",
    state.preferences?.avoidImages
      ? "Preferencia ativa: evitar imagens. Use generate_image somente se o usuario pedir explicitamente para gerar imagem agora."
      : "Preferencia de imagem: normal.",
    "So use generate_full_posts quando o usuario pedir claramente para produzir/gerar posts completos/pacote.",
    "",
    `Estado: ${JSON.stringify({
      activeClient: state.activeClient,
      currentWeekId: state.currentWeekId,
      pendingApproval: state.pendingApproval,
      hasPlan: Boolean(state.lastPlan),
      hasGeneratedContent: Boolean(state.lastGeneratedContent),
      lastImage: state.lastImage ? { dayLabel: state.lastImage.dayLabel, status: state.lastImage.status } : null
      ,
      preferences: state.preferences
    })}`,
    `Status da semana: ${JSON.stringify(weekStatus.days)}`,
    `Mensagem: ${message}`
  ].join("\n");
}

function parseRouterAction(raw: string): RouterAction {
  const jsonText = extractJson(raw);
  if (!jsonText) return { action: "unknown", confidence: 0 };

  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    const confidence = normalizeConfidence(parsed.confidence);
    const action = typeof parsed.action === "string" ? parsed.action : "unknown";

    if (action === "production_status") return { action, confidence };
    if (action === "generate_full_posts") return { action, confidence };
    if (action === "next_step") return { action, confidence };

    if (action === "show_day_package" || action === "generate_image") {
      const dayLabel = normalizeDayLabel(parsed.dayLabel);
      if (!dayLabel) return { action: "unknown", confidence: 0 };
      return { action, confidence, dayLabel };
    }

    if (action === "approve_parts") {
      const dayLabel = normalizeDayLabel(parsed.dayLabel);
      const parts = Array.isArray(parsed.parts)
        ? parsed.parts.filter((part): part is "copy" | "design" | "image" | "post" => {
            return typeof part === "string" && productionApprovalActionParts.includes(part as "copy" | "design" | "image" | "post");
          })
        : [];

      if (!dayLabel || parts.length === 0) return { action: "unknown", confidence: 0 };
      return { action, confidence, dayLabel, parts };
    }
  } catch {
    return { action: "unknown", confidence: 0 };
  }

  return { action: "unknown", confidence: 0 };
}

function extractJson(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;

  const match = trimmed.match(/\{[\s\S]*\}/);
  return match?.[0] || null;
}

function normalizeConfidence(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function normalizeDayLabel(value: unknown): ProductionDayLabel | null {
  if (typeof value !== "string") return null;
  const normalized = value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");

  return productionDayLabels.find((day) => normalized.includes(day.toLowerCase().replace("-feira", ""))) || null;
}
