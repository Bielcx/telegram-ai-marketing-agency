import type { AppConfig } from "../../config.js";
import { loadClientContext } from "../../clients/loader.js";
import { generateImageFile } from "../../openai/image.js";
import { generateText } from "../../openai/text.js";
import { OneOffStore } from "../../storage/oneOff.js";
import {
  buildOneOffCopyPrompt,
  buildOneOffDesignPrompt,
  buildOneOffPostPrompt
} from "../prompts.js";
import type { TaskMemory, UserState } from "../state.js";

export type OneOffResponse = {
  text: string;
  showThinking?: boolean;
  photoPath?: string;
};

export type OneOffRequest =
  | { kind: "one_off_design"; clientSlug: string; userRequest: string }
  | { kind: "one_off_copy"; clientSlug: string; userRequest: string }
  | { kind: "one_off_post"; clientSlug: string; userRequest: string };

export function detectOneOffRequest(
  message: string,
  activeClient: string,
  clientSlugs: string[],
  detectClientSlug: (message: string, clientSlugs: string[]) => string | null
): OneOffRequest | null {
  const text = normalizeMessage(message);
  const clientSlug = detectClientSlug(message, clientSlugs) || activeClient;

  if (looksLikeWeeklyProduction(text)) return null;
  if (looksLikeProductionCommand(text)) return null;

  const asksDesign =
    text.includes("design") ||
    text.includes("direcao visual") ||
    text.includes("arte") ||
    text.includes("capa") ||
    text.includes("layout") ||
    text.includes("visual");

  const asksCopy =
    text.includes("legenda") ||
    text.includes("caption") ||
    text.includes("copy") ||
    text.includes("texto") ||
    text.includes("descricao") ||
    text.includes("descrição");

  const asksPost =
    text.includes("post completo") ||
    text.includes("post pronto") ||
    text.includes("cria um post") ||
    text.includes("criar um post") ||
    text.includes("faz um post") ||
    text.includes("fazer um post");

  const hasPostContext =
    text.includes("post") ||
    text.includes("feed") ||
    text.includes("instagram") ||
    text.includes("reel") ||
    text.includes("carrossel") ||
    text.includes("story") ||
    text.includes("stories");

  const hasTopicContext =
    text.includes("sobre") ||
    text.includes("usando") ||
    text.includes("com base") ||
    text.includes("para ") ||
    text.includes("da ") ||
    text.includes("do ");

  if (asksPost && (asksCopy || asksDesign || hasPostContext)) {
    return { kind: "one_off_post", clientSlug, userRequest: message };
  }

  if (asksDesign && hasPostContext) {
    return { kind: "one_off_design", clientSlug, userRequest: message };
  }

  if (asksCopy && hasPostContext) {
    return { kind: "one_off_copy", clientSlug, userRequest: message };
  }

  if (asksCopy && hasTopicContext) {
    return { kind: "one_off_copy", clientSlug, userRequest: message };
  }

  return null;
}

export async function generateOneOffTask(
  config: AppConfig,
  state: UserState,
  request: OneOffRequest,
  oneOffStore?: OneOffStore
): Promise<OneOffResponse> {
  const context = await loadClientContext(config.agentKnowledgeDir, request.clientSlug);
  const content = await generateText(config, buildPromptForRequest(context, request));
  const task = buildTaskMemory(request, content);
  state.taskMemory = task;
  state.pendingApproval = task.visualPrompt ? "aprovar_tarefa_avulsa" : null;
  state.usage.oneOffTasks += 1;
  await oneOffStore?.saveTask(task);

  return {
    text: [
      task.summary,
      "",
      task.visualPrompt
        ? "Se estiver bom, responda aprovado. Depois posso gerar a imagem usando esse prompt."
        : "Se quiser ajustar, me diga o que mudar.",
      "Para ver tudo, diga: ver completo."
    ].join("\n"),
    showThinking: true
  };
}

export async function approveOneOffTask(state: UserState, oneOffStore?: OneOffStore): Promise<OneOffResponse | null> {
  if (!state.taskMemory || state.taskMemory.status !== "draft") return null;

  state.taskMemory.status = state.taskMemory.visualPrompt ? "ready_for_image" : "approved";
  state.taskMemory.updatedAt = new Date().toISOString();
  state.pendingApproval = null;
  await oneOffStore?.saveTask(state.taskMemory);

  if (state.taskMemory.visualPrompt) {
    return {
      text: [
        "Fechado. Aprovei essa tarefa avulsa.",
        "",
        "Se quiser gerar a imagem, pode dizer: gera a imagem."
      ].join("\n")
    };
  }

  return { text: "Fechado. Aprovei essa tarefa avulsa." };
}

export async function generateImageFromTaskMemory(
  config: AppConfig,
  state: UserState,
  userInstruction: string,
  oneOffStore?: OneOffStore
): Promise<OneOffResponse | null> {
  const task = state.taskMemory;
  if (!task?.visualPrompt) return null;

  const prompt = buildStrictOneOffImagePrompt(task, userInstruction);
  const sourceImagePath = await generateImageFile(config, prompt, `${task.clientSlug}-avulso`);
  const imagePath = oneOffStore ? await oneOffStore.saveImage(task, sourceImagePath) : sourceImagePath;

  task.status = "image_generated";
  task.imagePath = imagePath;
  task.updatedAt = new Date().toISOString();
  state.usage.imageGenerations += 1;
  state.pendingApproval = null;
  await oneOffStore?.saveTask(task);

  return {
    text: [
      "Imagem gerada para o ultimo pedido avulso.",
      "",
      "Se estiver boa, responda aprovado. Se quiser mudar, me diga o ajuste."
    ].join("\n"),
    photoPath: imagePath,
    showThinking: true
  };
}

export function buildTaskMemorySummary(state: UserState): string | null {
  const task = state.taskMemory;
  if (!task) return null;

  return [
    "Ultima tarefa avulsa:",
    `- cliente: ${task.clientSlug}`,
    `- tipo: ${formatTaskKind(task.kind)}`,
    `- status: ${formatTaskStatus(task.status)}`,
    `- tem prompt visual: ${task.visualPrompt ? "sim" : "nao"}`,
    task.imagePath ? `- imagem: ${task.imagePath}` : null
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildTaskMemoryFullContent(state: UserState): string | null {
  if (!state.taskMemory) return null;
  return state.taskMemory.content;
}

export function buildOneOffListText(clientName: string, tasks: TaskMemory[]): string {
  if (tasks.length === 0) {
    return `Ainda nao encontrei avulsos salvos para ${clientName}.`;
  }

  return [
    `Avulsos salvos para ${clientName}:`,
    "",
    ...tasks.map((task, index) => {
      const title =
        extractFieldValue(task.content, "**Tema:**") ||
        extractFieldValue(task.content, "**Texto da capa:**") ||
        formatTaskKind(task.kind);

      return [
        `${index + 1}. ${title}`,
        `   tipo: ${formatTaskKind(task.kind)} | status: ${formatTaskStatus(task.status)}`,
        `   id: ${task.id}`
      ].join("\n");
    }),
    "",
    "Para abrir um item, diga: ver avulso 1. Para ver o ultimo completo, diga: ver completo."
  ].join("\n");
}

function buildPromptForRequest(context: Awaited<ReturnType<typeof loadClientContext>>, request: OneOffRequest): string {
  if (request.kind === "one_off_design") return buildOneOffDesignPrompt(context, request.userRequest);
  if (request.kind === "one_off_copy") return buildOneOffCopyPrompt(context, request.userRequest);
  return buildOneOffPostPrompt(context, request.userRequest);
}

function buildTaskMemory(request: OneOffRequest, content: string): TaskMemory {
  const id = buildTaskId(request.kind);
  return {
    id,
    kind: request.kind,
    clientSlug: request.clientSlug,
    userRequest: request.userRequest,
    content,
    summary: buildShortSummary(request, content),
    visualPrompt: extractFieldValue(content, "**Prompt visual:**"),
    coverText: extractFieldValue(content, "**Texto da capa:**"),
    status: "draft",
    imagePath: null,
    updatedAt: new Date().toISOString()
  };
}

function buildTaskId(kind: OneOffRequest["kind"]): string {
  return `${kind.replace("one_off_", "")}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
}

function buildShortSummary(request: OneOffRequest, content: string): string {
  const title = request.kind === "one_off_design" ? "Design avulso criado" : request.kind === "one_off_copy" ? "Copy avulsa criada" : "Post avulso criado";
  const format = extractFieldValue(content, "**Formato:**");
  const theme = extractFieldValue(content, "**Tema:**");
  const cover = extractFieldValue(content, "**Texto da capa:**");
  const caption = extractFieldValue(content, "**Legenda pronta:**") || extractFieldValue(content, "**Legenda:**") || extractFirstUsefulContentLine(content);
  const cta = extractFieldValue(content, "**CTA:**") || extractCtaLine(content);
  const recommendation = extractFieldValue(content, "**Recomendacao:**") || extractFieldValue(content, "**Recomendação:**");

  return [
    title,
    "",
    format ? `Formato: ${format}` : null,
    theme ? `Tema: ${theme}` : null,
    cover ? `Capa: ${cover}` : null,
    request.kind === "one_off_copy" && caption ? `Comeco: ${truncate(caption, 180)}` : null,
    request.kind === "one_off_copy" && cta ? `CTA: ${truncate(cta, 140)}` : null,
    recommendation ? `Direcao recomendada: ${recommendation}` : null,
    "",
    "Salvei a versao completa na tarefa avulsa."
  ]
    .filter(Boolean)
    .join("\n");
}

function extractFirstUsefulContentLine(markdown: string): string | null {
  const ignored = new Set(["copy avulsa", "post avulso", "design avulso"]);
  for (const line of markdown.split("\n")) {
    const cleaned = line
      .replace(/^#+\s*/, "")
      .replace(/^[-*]\s+/, "")
      .replace(/^\d+\.\s+/, "")
      .replace(/\*\*/g, "")
      .trim();

    if (!cleaned) continue;
    if (ignored.has(normalizeMessage(cleaned))) continue;
    if (/^[A-Za-zÀ-ÿ ]+:$/.test(cleaned)) continue;
    return cleaned;
  }

  return null;
}

function extractCtaLine(markdown: string): string | null {
  const lines = markdown.split("\n");
  const index = lines.findIndex((line) => normalizeMessage(line).includes("cta"));
  if (index === -1) return null;

  for (const line of lines.slice(index + 1)) {
    const cleaned = line.replace(/^[-*]\s+/, "").replace(/\*\*/g, "").trim();
    if (cleaned) return cleaned;
  }

  return null;
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3).trim()}...`;
}

function buildStrictOneOffImagePrompt(task: TaskMemory, userInstruction: string): string {
  const lines = [
    task.visualPrompt || task.content,
    "",
    "Regras obrigatorias para a imagem final:",
    "- Formato quadrado 1024x1024 para Instagram.",
    "- Nao inventar titulo, subtitulo, rodape, slogan ou frases extras.",
    "- Nao adicionar texto pequeno decorativo, exceto se estiver explicitamente pedido.",
    "- Priorizar legibilidade, margem ampla e composicao limpa.",
    "- Seguir a identidade visual do cliente descrita no prompt."
  ];

  if (task.coverText) {
    lines.push(`- Usar exatamente este texto na capa, sem alterar palavras: "${task.coverText}"`);
  }

  lines.push(`- Pedido atual do usuario: ${userInstruction}`);

  return lines.join("\n");
}

function extractFieldValue(markdown: string, marker: string): string | null {
  const lines = markdown.split("\n");
  const markerIndex = lines.findIndex((line) => line.trim().startsWith(marker));
  if (markerIndex === -1) return null;

  const markerLine = lines[markerIndex].trim();
  const inlineValue = markerLine.slice(marker.length).trim();
  if (inlineValue) return inlineValue;

  const valueLines: string[] = [];
  for (const line of lines.slice(markerIndex + 1)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^\*\*.+:\*\*/.test(trimmed) || /^##\s+/.test(trimmed)) break;
    valueLines.push(trimmed);
  }

  return valueLines.join(" ").trim() || null;
}

function looksLikeWeeklyProduction(text: string): boolean {
  return (
    text.includes("semana") ||
    text.includes("calendario") ||
    text.includes("pauta semanal") ||
    text.includes("posts completos da semana")
  );
}

function looksLikeProductionCommand(text: string): boolean {
  return (
    text.includes("status da semana") ||
    text.includes("aprovar texto de") ||
    text.includes("aprovar design de") ||
    text.includes("mostra post de") ||
    text.includes("mostre post de") ||
    text.includes("pacote completo")
  );
}

function formatTaskKind(kind: TaskMemory["kind"]): string {
  if (kind === "one_off_design") return "design avulso";
  if (kind === "one_off_copy") return "copy avulsa";
  if (kind === "one_off_post") return "post avulso";
  return "imagem avulsa";
}

function formatTaskStatus(status: TaskMemory["status"]): string {
  if (status === "draft") return "rascunho";
  if (status === "approved") return "aprovada";
  if (status === "ready_for_image") return "pronta para imagem";
  return "imagem gerada";
}

function normalizeMessage(message: string): string {
  return message
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();
}
