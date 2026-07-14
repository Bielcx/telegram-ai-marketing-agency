import type { AppConfig } from "../../config.js";
import { generateImageFile } from "../../openai/image.js";
import { ProductionStore } from "../../storage/production.js";
import type { UserState } from "../state.js";

export type ImageToolResponse = {
  text: string;
  showThinking?: boolean;
  photoPath?: string;
};

export type ExtractDaySection = (markdown: string, dayLabel: string) => string | null;
export type ExtractFieldValue = (markdown: string, marker: string) => string | null;

export function buildImageGenerationRequest(
  state: UserState,
  dayLabel: string,
  instruction: string,
  extractDaySection: ExtractDaySection,
  extractFieldValue: ExtractFieldValue
): ImageToolResponse {
  const designSection = state.lastDesign ? extractDaySection(state.lastDesign, dayLabel) : null;
  if (!designSection) {
    return { text: `Nao encontrei o design de ${dayLabel} para gerar imagem.` };
  }

  const visualPrompt = extractFieldValue(designSection, "**Prompt visual:**");
  const coverText = extractFieldValue(designSection, "**Texto da capa:**");
  if (!visualPrompt) {
    return { text: `Encontrei o design de ${dayLabel}, mas nao achei um prompt visual claro.` };
  }

  state.pendingImage = {
    dayLabel,
    prompt: buildStrictImagePrompt(visualPrompt, coverText, instruction)
  };
  state.pendingApproval = "gerar_imagem";

  return {
    text: [
      `Vou gerar a imagem de ${dayLabel} usando este prompt:`,
      "",
      state.pendingImage.prompt,
      "",
      "Isso vai consumir uma chamada de imagem da OpenAI.",
      "Se estiver ok, responda: aprovado"
    ].join("\n"),
    showThinking: true
  };
}

export async function generatePendingImage(
  config: AppConfig,
  productionStore: ProductionStore,
  state: UserState
): Promise<ImageToolResponse> {
  if (!state.pendingImage) {
    return { text: "Nao encontrei uma imagem pendente para gerar." };
  }

  const activeClient = requireActiveClient(state);
  const currentWeekId = requireCurrentWeekId(state);
  const imagePath = await generateImageFile(
    config,
    state.pendingImage.prompt,
    `${activeClient}-${state.pendingImage.dayLabel}`
  );
  const dayLabel = state.pendingImage.dayLabel;
  const productionImagePath = await productionStore.saveImageDraft(
    activeClient,
    currentWeekId,
    dayLabel,
    imagePath
  );

  state.lastImage = {
    dayLabel,
    path: productionImagePath,
    prompt: state.pendingImage.prompt,
    status: "draft"
  };
  state.pendingImage = null;
  state.pendingApproval = null;

  return {
    text: [
      `Imagem gerada para ${dayLabel}.`,
      "",
      "Se estiver boa, responda: aprovado",
      "Se quiser mudar, me diga algo como: refaz mais minimalista"
    ].join("\n"),
    photoPath: productionImagePath,
    showThinking: true
  };
}

export async function approveLastImage(
  productionStore: ProductionStore,
  state: UserState
): Promise<ImageToolResponse> {
  if (!state.lastImage || state.lastImage.status !== "draft") {
    return { text: "Nao encontrei uma imagem em rascunho para aprovar." };
  }

  state.lastImage.status = "approved";
  await productionStore.approveImage(requireActiveClient(state), requireCurrentWeekId(state), state.lastImage.dayLabel);

  return { text: `Fechado. Aprovei a imagem de ${state.lastImage.dayLabel} como versao final.` };
}

function buildStrictImagePrompt(visualPrompt: string, coverText: string | null, userInstruction: string): string {
  const lines = [
    visualPrompt,
    "",
    "Regras obrigatorias para a imagem final:",
    "- Formato quadrado 1024x1024 para Instagram.",
    "- Nao inventar titulo, subtitulo, rodape, slogan ou frases extras.",
    "- Nao adicionar texto pequeno decorativo, exceto se estiver explicitamente pedido.",
    "- Priorizar legibilidade, margem ampla e composicao minimalista.",
    "- Manter identidade visual: bege claro, azul marinho e dourado sutil."
  ];

  if (coverText) {
    lines.push(`- Usar exatamente este texto na capa, sem alterar palavras: "${coverText}"`);
  }

  lines.push(`- Pedido atual do usuario: ${userInstruction}`);

  return lines.join("\n");
}

function requireActiveClient(state: UserState): string {
  if (!state.activeClient) throw new Error("Missing active client.");
  return state.activeClient;
}

function requireCurrentWeekId(state: UserState): string {
  if (!state.currentWeekId) throw new Error("Missing current week id.");
  return state.currentWeekId;
}
