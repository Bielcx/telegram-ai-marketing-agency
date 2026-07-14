import { ProductionStore, type ProductionApprovalPart, type ProductionApprovalResult, type ProductionWeekStatus } from "../../storage/production.js";
import type { UserState } from "../state.js";

export type DayDescriptor = {
  key: string;
  label: string;
};

export type ExtractDaySection = (markdown: string, dayLabel: string) => string | null;

export async function getProductionStatusText(
  productionStore: ProductionStore,
  state: UserState,
  avoidImages = false
): Promise<string> {
  const status = await productionStore.getWeekStatus(requireActiveClient(state), requireCurrentWeekId(state));
  return buildProductionStatusResponse(status, avoidImages);
}

export async function approveProductionPartText(
  productionStore: ProductionStore,
  state: UserState,
  dayLabel: string,
  part: ProductionApprovalPart,
  avoidImages = false
): Promise<string> {
  const result = await productionStore.approveDayPart(requireActiveClient(state), requireCurrentWeekId(state), dayLabel, part);
  return buildProductionApprovalResponse(dayLabel, part, result, avoidImages);
}

export async function readProductionDayPackageText(
  productionStore: ProductionStore,
  state: UserState,
  dayLabel: string
): Promise<string> {
  const dayPackage = await productionStore.readDayPackage(requireActiveClient(state), requireCurrentWeekId(state), dayLabel);

  return dayPackage || `Ainda nao tenho um pacote salvo para ${dayLabel}. Gere ou aprove os posts completos primeiro.`;
}

export async function saveGeneratedProductionPackage(
  productionStore: ProductionStore,
  state: UserState,
  copy: string,
  design: string,
  review: string,
  content: string,
  days: DayDescriptor[],
  extractDaySection: ExtractDaySection
): Promise<void> {
  await productionStore.savePackage(requireActiveClient(state), requireCurrentWeekId(state), copy, design, review, content);
  await saveProductionDaySections(productionStore, requireActiveClient(state), requireCurrentWeekId(state), copy, design, days, extractDaySection);
}

export async function syncStateToProduction(
  productionStore: ProductionStore,
  state: UserState,
  days: DayDescriptor[],
  extractDaySection: ExtractDaySection
): Promise<void> {
  if (!state.activeClient || !state.currentWeekId) return;

  if (state.lastPlan) {
    await productionStore.savePlan(state.activeClient, state.currentWeekId, state.lastPlan);
  }

  if (state.lastCopy && state.lastDesign && state.lastReview && state.lastGeneratedContent) {
    await productionStore.savePackage(
      state.activeClient,
      state.currentWeekId,
      state.lastCopy,
      state.lastDesign,
      state.lastReview,
      state.lastGeneratedContent
    );
    await saveProductionDaySections(productionStore, state.activeClient, state.currentWeekId, state.lastCopy, state.lastDesign, days, extractDaySection);
  }

  if (state.lastImage) {
    await productionStore.setImageStatus(
      state.activeClient,
      state.currentWeekId,
      state.lastImage.dayLabel,
      state.lastImage.path,
      state.lastImage.status
    );
  }
}

export function statusLabel(value: "missing" | "draft" | "approved"): string {
  if (value === "approved") return "aprovado";
  if (value === "draft") return "rascunho";
  return "faltando";
}

function buildProductionStatusResponse(status: ProductionWeekStatus, avoidImages = false): string {
  const dayLines = status.days.map((day) => {
    return `- ${day.dayLabel}: texto ${statusLabel(day.copy)}, design ${statusLabel(day.design)}, imagem ${statusLabel(day.image)}`;
  });
  const everythingMissing = status.days.every((day) => day.copy === "missing" && day.design === "missing" && day.image === "missing");

  const missing = status.days
    .filter((day) => day.copy !== "approved" || day.design !== "approved" || day.image !== "approved")
    .map((day) => day.dayLabel);

  return [
    `Status da semana ${status.weekId} - ${status.clientSlug}`,
    "",
    ...dayLines,
    "",
    missing.length > 0
      ? `Ainda falta fechar: ${missing.join(", ")}.`
      : "Tudo desta semana esta aprovado.",
    "",
    everythingMissing
      ? "Essa semana ainda nao tem posts completos salvos. O proximo passo e gerar ou aprovar os posts completos da pauta."
      : avoidImages
        ? "Como voce esta evitando imagens, o melhor proximo passo e aprovar texto/design dos posts em rascunho ou pedir um post especifico."
        : "Voce pode pedir: mostra post de terca, gerar imagem de quarta ou pacote completo."
  ].join("\n");
}

function buildProductionApprovalResponse(
  dayLabel: string,
  part: ProductionApprovalPart,
  result: ProductionApprovalResult,
  avoidImages = false
): string {
  const { status } = result;
  const partLabel =
    part === "copy" ? "texto" : part === "design" ? "design" : part === "image" ? "imagem" : "post";

  if (result.approved.length === 0) {
    return [
      `Ainda nao consigo aprovar ${partLabel} de ${dayLabel}.`,
      "",
      `Esse item ainda nao existe na producao. Status atual: texto ${statusLabel(status.copy)}, design ${statusLabel(status.design)}, imagem ${statusLabel(status.image)}.`,
      buildMissingProductionNextStep(status)
    ].join("\n");
  }

  const missing = [
    status.copy === "missing" ? "texto" : null,
    status.design === "missing" ? "design" : null,
    status.image === "missing" ? "imagem" : null
  ].filter(Boolean);
  const pending = [
    status.copy === "draft" ? "texto" : null,
    status.design === "draft" ? "design" : null,
    status.image === "draft" ? "imagem" : null
  ].filter(Boolean);

  const approvedLabel = result.approved.map((item) => partName(item)).join(", ");
  const onlyMissingImage = missing.length === 1 && missing[0] === "imagem";
  const nextStep =
    missing.length > 0
      ? avoidImages && onlyMissingImage
        ? "Imagem continua pendente, mas esta em pausa pelo modo economia."
        : `Ainda falta: ${missing.join(", ")}.`
      : pending.length > 0
        ? `Ainda falta aprovar: ${pending.join(", ")}.`
        : avoidImages
          ? "Post completo aprovado no que nao envolve imagem. Imagem continua em pausa pelo modo economia."
        : "Post completo aprovado.";

  return [
    `Fechado. Aprovei ${approvedLabel} de ${dayLabel}.`,
    "",
    `Status atual: texto ${statusLabel(status.copy)}, design ${statusLabel(status.design)}, imagem ${statusLabel(status.image)}.`,
    nextStep
  ].join("\n");
}

function buildMissingProductionNextStep(status: { copy: "missing" | "draft" | "approved"; design: "missing" | "draft" | "approved"; image: "missing" | "draft" | "approved" }): string {
  if (status.copy === "missing" && status.design === "missing") {
    return "O proximo passo e gerar os posts completos da semana. Se ja houver pauta aprovada, responda: aprovado.";
  }

  if (status.image === "missing") {
    return "O proximo passo e gerar a imagem/capa desse post.";
  }

  return "Peca status da semana para ver a proxima pendencia.";
}

function partName(part: Exclude<ProductionApprovalPart, "post">): string {
  if (part === "copy") return "texto";
  if (part === "design") return "design";
  return "imagem";
}

async function saveProductionDaySections(
  productionStore: ProductionStore,
  clientSlug: string,
  weekId: string,
  copy: string,
  design: string,
  days: DayDescriptor[],
  extractDaySection: ExtractDaySection
): Promise<void> {
  for (const day of days) {
    const copySection = extractDaySection(copy, day.label);
    const designSection = extractDaySection(design, day.label);

    if (copySection) {
      await productionStore.saveDaySection(clientSlug, weekId, day.label, "copy", copySection);
    }

    if (designSection) {
      await productionStore.saveDaySection(clientSlug, weekId, day.label, "design", designSection);
    }
  }
}

function requireActiveClient(state: UserState): string {
  if (!state.activeClient) throw new Error("Missing active client.");
  return state.activeClient;
}

function requireCurrentWeekId(state: UserState): string {
  if (!state.currentWeekId) throw new Error("Missing current week id.");
  return state.currentWeekId;
}
