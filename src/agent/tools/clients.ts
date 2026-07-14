import { ProductionStore, type ProductionWeekStatus } from "../../storage/production.js";
import type { UserState } from "../state.js";

export function getDefaultClientSlug(clientSlugs: string[]): string {
  return clientSlugs.includes("cliente-demo") ? "cliente-demo" : clientSlugs[0] || "cliente-demo";
}

export async function resolveWeekIdForClient(
  productionStore: ProductionStore,
  clientSlug: string,
  preferredWeekId: string | null = null
): Promise<string> {
  if (preferredWeekId) {
    const preferredStatus = await productionStore.getWeekStatus(clientSlug, preferredWeekId);
    if (!isWeekEmpty(preferredStatus)) return preferredWeekId;
  }

  return (await productionStore.getLatestWeekId(clientSlug)) || productionStore.getCurrentWeekId();
}

export function switchActiveClient(state: UserState, clientSlug: string, weekId: string): void {
  state.activeClient = clientSlug;
  state.state = "cliente_selecionado";
  state.lastIntent = null;
  state.lastWeeklyGoal = null;
  state.lastPlan = null;
  state.lastCopy = null;
  state.lastDesign = null;
  state.lastReview = null;
  state.lastGeneratedContent = null;
  state.currentWeekId = weekId;
  state.pendingRevision = null;
  state.pendingImage = null;
  state.lastImage = null;
  state.pendingApproval = null;
}

export async function buildClientCommandResponse(
  message: string,
  state: UserState,
  clientSlugs: string[],
  productionStore: ProductionStore,
  buildNextStepText: (state: UserState) => string
): Promise<string | null> {
  const text = normalizeMessage(message);

  if (
    text === "clientes" ||
    text === "listar clientes" ||
    text === "lista clientes" ||
    text === "quais clientes" ||
    text === "clientes disponiveis"
  ) {
    return [
      "Clientes disponiveis:",
      ...clientSlugs.map((slug) => `- ${formatClientName(slug)}${slug === state.activeClient ? " (ativo)" : ""}`),
      "",
      "Para trocar, diga: usar cliente nome."
    ].join("\n");
  }

  if (
    text === "cliente atual" ||
    text === "qual cliente" ||
    text === "qual cliente ativo" ||
    text === "perfil atual" ||
    text === "quem esta ativo"
  ) {
    return `Cliente ativo: ${formatClientName(state.activeClient || getDefaultClientSlug(clientSlugs))}.`;
  }

  const explicitClient = detectExplicitClientSelection(message, clientSlugs);
  if (!explicitClient) return null;

  if (explicitClient === state.activeClient) {
    return `Cliente ativo: ${formatClientName(explicitClient)}.`;
  }

  switchActiveClient(state, explicitClient, await resolveWeekIdForClient(productionStore, explicitClient));

  return [
    `Cliente ativo alterado para ${formatClientName(explicitClient)}.`,
    "",
    "A sessao operacional foi limpa para nao misturar pauta, texto ou design de outro cliente.",
    buildNextStepText(state)
  ].join("\n");
}

export function detectClientSlug(message: string, clientSlugs: string[]): string | null {
  const text = normalizeMessage(message);

  return clientSlugs.find((slug) => text.includes(normalizeMessage(slug))) || null;
}

export function formatClientName(slug: string): string {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function detectExplicitClientSelection(message: string, clientSlugs: string[]): string | null {
  const text = normalizeMessage(message);

  for (const slug of clientSlugs) {
    const normalizedSlug = normalizeMessage(slug);
    if (
      text === normalizedSlug ||
      text === `cliente ${normalizedSlug}` ||
      text.includes(`usar cliente ${normalizedSlug}`) ||
      text.includes(`selecionar cliente ${normalizedSlug}`) ||
      text.includes(`mudar para ${normalizedSlug}`) ||
      text.includes(`trocar para ${normalizedSlug}`)
    ) {
      return slug;
    }
  }

  return null;
}

function isWeekEmpty(status: ProductionWeekStatus): boolean {
  return status.days.every((day) => day.copy === "missing" && day.design === "missing" && day.image === "missing");
}

function normalizeMessage(message: string): string {
  return message
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();
}

