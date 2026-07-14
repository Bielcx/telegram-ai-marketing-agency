import type { AppConfig } from "../config.js";
import { listClientSlugs, loadClientContext } from "../clients/loader.js";
import { generateText } from "../openai/text.js";
import type { FileSessionStore } from "../storage/filesystem.js";
import { OneOffStore } from "../storage/oneOff.js";
import { ProductionStore, type ProductionApprovalPart } from "../storage/production.js";
import { detectIntent } from "./intent.js";
import {
  buildConversationPrompt,
  buildResearchEnhancedRequest,
  buildResponseComposerPrompt,
} from "./prompts.js";
import { routeMessageWithAI, type RouterAction } from "./router.js";
import { createDefaultPreferences, createDefaultUsageState, type UserState } from "./state.js";
import {
  approveProductionPartText,
  getProductionStatusText,
  readProductionDayPackageText,
  saveGeneratedProductionPackage,
  statusLabel,
  syncStateToProduction
} from "./tools/production.js";
import {
  buildClientCommandResponse,
  detectClientSlug,
  formatClientName,
  getDefaultClientSlug,
  resolveWeekIdForClient,
  switchActiveClient
} from "./tools/clients.js";
import { generateFullPostPackage, generateWeeklyPlan, reviseDayContent } from "./tools/content.js";
import { approveLastImage, buildImageGenerationRequest, generatePendingImage } from "./tools/images.js";
import {
  approveOneOffTask,
  buildOneOffListText,
  buildTaskMemoryFullContent,
  buildTaskMemorySummary,
  detectOneOffRequest,
  generateImageFromTaskMemory,
  generateOneOffTask
} from "./tools/oneOff.js";
import {
  buildResearchStatusText,
  ensureResearchState,
  getReusableResearchSummary,
  runResearch,
  shouldUseResearch,
  wantsReuseLastResearch,
  wantsResearchOnly,
  wantsResearchStatus
} from "./tools/research.js";
export type OrchestratorResponse = {
  text: string;
  showThinking?: boolean;
  photoPath?: string;
};

type NextStepState = {
  state: string;
  pendingApproval: string | null;
  lastGeneratedContent: string | null;
  lastDesign: string | null;
  activeClient?: string | null;
  lastImage?: { dayLabel: string; status: string } | null;
  taskMemory?: { kind: string; status: string; visualPrompt: string | null } | null;
  preferences?: { avoidImages: boolean };
};

export function createOrchestrator(config: AppConfig, sessionStore: FileSessionStore) {
  const productionStore = new ProductionStore(config.dataDir);
  const oneOffStore = new OneOffStore(config.dataDir);

  return {
    async handleMessage(userId: string, message: string): Promise<OrchestratorResponse> {
      const state = await sessionStore.getState(userId);
      const detected = detectIntent(message);
      const clientSlugs = await listClientSlugs(config.agentKnowledgeDir);

      state.lastImage ??= null;
      state.taskMemory ??= null;
      state.usage ??= createDefaultUsageState();
      if (state.usage.monthKey !== new Date().toISOString().slice(0, 7)) {
        state.usage = createDefaultUsageState();
      }
      ensureResearchState(state, config.researchMonthlyLimit);
      state.currentWeekId ??= productionStore.getCurrentWeekId();
      state.preferences ??= createDefaultPreferences();
      state.preferences.beginnerMode ??= true;

      if (!state.activeClient) {
        state.activeClient = getDefaultClientSlug(clientSlugs);
      }

      state.currentWeekId = await resolveWeekIdForClient(productionStore, state.activeClient, state.currentWeekId);

      const clientCommandResponse = await buildClientCommandResponse(message, state, clientSlugs, productionStore, buildNextStepResponse);
      if (clientCommandResponse) {
        await sessionStore.saveState(state);
        return { text: clientCommandResponse };
      }

      const mentionedClient = detectClientSlug(message, clientSlugs) || detected.clientSlug;
      if (mentionedClient && mentionedClient !== state.activeClient) {
        switchActiveClient(state, mentionedClient, await resolveWeekIdForClient(productionStore, mentionedClient));
      }

      const requestedDay = detectWeekday(message);

      if (wantsStorageDebug(message)) {
        const latestWeekId = await productionStore.getLatestWeekId(state.activeClient);
        const status = await productionStore.getWeekStatus(state.activeClient, state.currentWeekId);
        await sessionStore.saveState(state);

        return {
          text: [
            "Debug storage",
            "",
            `cwd: ${process.cwd()}`,
            `DATA_DIR config: ${config.dataDir}`,
            `production root: ${productionStore.getProductionRootDir()}`,
            `cliente ativo: ${state.activeClient}`,
            `semana no estado: ${state.currentWeekId}`,
            `ultima semana salva: ${latestWeekId || "nenhuma"}`,
            `week dir lido: ${productionStore.getClientWeekDir(state.activeClient, state.currentWeekId)}`,
            "",
            "Status lido:",
            ...status.days.map((day) => `- ${day.dayLabel}: texto ${statusLabel(day.copy)}, design ${statusLabel(day.design)}, imagem ${statusLabel(day.image)}`)
          ].join("\n")
        };
      }

      const preferenceResponse = applyPreferenceMessage(message, state);
      if (preferenceResponse) {
        await sessionStore.saveState(state);
        return { text: preferenceResponse };
      }

      if (wantsResearchStatus(message)) {
        const text = buildResearchStatusText(state, config.researchMonthlyLimit);
        await sessionStore.saveState(state);
        return { text };
      }

      if (wantsUsageStatus(message)) {
        await sessionStore.saveState(state);
        return { text: buildUsageStatusText(state) };
      }

      if (wantsOneOffList(message)) {
        const clientForList = detectClientSlug(message, clientSlugs) || state.activeClient;
        const tasks = await oneOffStore.listTasks(clientForList, 10);
        await sessionStore.saveState(state);
        return { text: buildOneOffListText(formatClientName(clientForList), tasks) };
      }

      if (wantsResearchOnly(message)) {
        const response = await runResearch(config, state, state.activeClient, message);
        await sessionStore.saveState(state);
        return response;
      }

      if (wantsTaskMemoryStatus(message)) {
        await sessionStore.saveState(state);
        return { text: buildTaskMemorySummary(state) || "Ainda nao tenho uma tarefa avulsa em andamento." };
      }

      const oneOffPosition = detectOneOffViewPosition(message);
      if (oneOffPosition) {
        const clientForTask = detectClientSlug(message, clientSlugs) || state.activeClient;
        const task = await oneOffStore.getTaskByPosition(clientForTask, oneOffPosition);
        if (task) {
          state.taskMemory = task;
          state.pendingApproval = task.status === "draft" ? "aprovar_tarefa_avulsa" : state.pendingApproval;
          await sessionStore.saveState(state);
          return { text: task.content };
        }

        await sessionStore.saveState(state);
        return { text: `Nao encontrei o avulso ${oneOffPosition} para ${formatClientName(clientForTask)}.` };
      }

      if (wantsTaskFullContent(message)) {
        await sessionStore.saveState(state);
        return { text: buildTaskMemoryFullContent(state) || "Ainda nao tenho uma tarefa avulsa completa para mostrar." };
      }

      if (state.taskMemory?.visualPrompt && wantsGenerateImageFromCurrentTask(message, state) && !requestedDay) {
        if (state.preferences.avoidImages && !wantsForceImageGeneration(message) && !wantsImageAdjustment(message)) {
          await sessionStore.saveState(state);
          return {
            text: [
              "Tenho um prompt visual aprovado/recente para o ultimo pedido avulso.",
              "",
              "Como o modo de evitar imagens esta ligado, confirma que quer gastar uma chamada de imagem?",
              "Se sim, diga: pode gerar."
            ].join("\n")
          };
        }

        const response = await generateImageFromTaskMemory(config, state, buildOneOffImageInstruction(message, state), oneOffStore);
        await sessionStore.saveState(state);

        if (response) return response;
      }

      if (detected.intent === "aprovar_pauta" && state.pendingApproval === "aprovar_tarefa_avulsa") {
        const response = await approveOneOffTask(state, oneOffStore);
        await sessionStore.saveState(state);

        if (response) return { ...response, text: buildOneOffApprovalResponse(state, response.text) };
      }

      if (detected.intent === "aprovar_pauta" && state.taskMemory?.status === "draft") {
        const response = await approveOneOffTask(state, oneOffStore);
        await sessionStore.saveState(state);

        if (response) return { ...response, text: buildOneOffApprovalResponse(state, response.text) };
      }

      if (detected.intent === "aprovar_pauta" && state.taskMemory && state.taskMemory.status !== "draft") {
        await sessionStore.saveState(state);
        return {
          text: buildOneOffApprovalResponse(
            state,
            state.taskMemory.status === "ready_for_image"
              ? "Esse avulso ja esta aprovado e pronto para virar imagem."
              : "Esse avulso ja esta aprovado."
          )
        };
      }
      if (state.taskMemory?.visualPrompt && wantsGenerateImageFromCurrentTask(message, state) && !requestedDay) {
        if (state.preferences.avoidImages && !wantsForceImageGeneration(message) && !wantsImageAdjustment(message)) {
          await sessionStore.saveState(state);
          return {
            text: [
              "Tenho um prompt visual aprovado/recente para o ultimo pedido avulso.",
              "",
              "Como o modo de evitar imagens esta ligado, confirma que quer gastar uma chamada de imagem?",
              "Se sim, diga: pode gerar."
            ].join("\n")
          };
        }

        const response = await generateImageFromTaskMemory(config, state, buildOneOffImageInstruction(message, state), oneOffStore);
        await sessionStore.saveState(state);

        if (response) return response;
      }

      if (wantsProductionStatus(message)) {
        await syncStateToProduction(productionStore, state, productionDays(), extractDaySection);
        const text = await composeOperationalResponse(
          config,
          state,
          message,
          await getProductionStatusText(productionStore, state, state.preferences.avoidImages)
        );
        await sessionStore.saveState(state);
        return { text };
      }

      if (requestedDay && wantsProductionApproval(message)) {
        await syncStateToProduction(productionStore, state, productionDays(), extractDaySection);
        const part = detectProductionApprovalPart(message);
        const text = await composeOperationalResponse(
          config,
          state,
          message,
          await approveProductionPartText(productionStore, state, requestedDay.label, part, state.preferences.avoidImages)
        );
        await sessionStore.saveState(state);

        return { text };
      }

      if (requestedDay && wantsProductionDayPackage(message)) {
        await syncStateToProduction(productionStore, state, productionDays(), extractDaySection);
        await sessionStore.saveState(state);

        return {
          text: await readProductionDayPackageText(productionStore, state, requestedDay.label)
        };
      }

      if (detected.intent === "aprovar_pauta" && state.pendingApproval === "salvar_revisao" && state.pendingRevision) {
        if (state.pendingRevision.kind === "copy" && state.lastCopy) {
          state.lastCopy = replaceDaySection(state.lastCopy, state.pendingRevision.dayLabel, state.pendingRevision.content);
          await productionStore.saveDaySection(
            state.activeClient,
            state.currentWeekId,
            state.pendingRevision.dayLabel,
            "copy",
            state.pendingRevision.content
          );
        }

        if (state.pendingRevision.kind === "design" && state.lastDesign) {
          state.lastDesign = replaceDaySection(state.lastDesign, state.pendingRevision.dayLabel, state.pendingRevision.content);
          await productionStore.saveDaySection(
            state.activeClient,
            state.currentWeekId,
            state.pendingRevision.dayLabel,
            "design",
            state.pendingRevision.content
          );
        }

        const savedKind = state.pendingRevision.kind === "design" ? "design" : "texto";
        const savedDay = state.pendingRevision.dayLabel;
        state.pendingRevision = null;
        state.pendingApproval = null;
        await sessionStore.saveState(state);

        return { text: `Fechado. Salvei a nova versao de ${savedKind} para ${savedDay}.` };
      }

      if (detected.intent === "aprovar_pauta" && state.pendingApproval === "gerar_imagem" && state.pendingImage) {
        const response = await generatePendingImage(config, productionStore, state);
        await sessionStore.saveState(state);

        return response;
      }

      if (detected.intent === "aprovar_pauta" && state.lastImage?.status === "draft" && !state.pendingApproval) {
        const response = await approveLastImage(productionStore, state);
        await sessionStore.saveState(state);

        return response;
      }

      if (detected.intent === "criar_calendario") {
        if ((state.lastPlan || state.lastGeneratedContent) && !wantsNewProduction(message)) {
          await sessionStore.saveState(state);
          return {
            text: [
              `Ja existe uma semana em andamento para ${formatClientName(state.activeClient || "cliente")}.`,
              "",
              "Voce quer ver o status da semana atual ou criar uma nova pauta?",
              "",
              "Pode responder:",
              "- status da semana",
              "- criar nova pauta"
            ].join("\n")
          };
        }

        let weeklyGoal = detected.weeklyGoal || "autoridade e conexao";
        const reusableResearchSummary = wantsReuseLastResearch(message)
          ? getReusableResearchSummary(state, state.activeClient)
          : null;
        if (reusableResearchSummary) {
          weeklyGoal = buildResearchEnhancedRequest(weeklyGoal, reusableResearchSummary);
        } else if (shouldUseResearch(message)) {
          const research = await runResearch(config, state, state.activeClient, message);
          if (state.research.lastResearch?.summary) {
            weeklyGoal = buildResearchEnhancedRequest(weeklyGoal, state.research.lastResearch.summary);
          } else if (research.text.includes("Limite mensal")) {
            weeklyGoal = `${weeklyGoal}\n\nObservacao: o usuario pediu pesquisa, mas o limite mensal foi atingido.`;
          }
        }
        const plan = await generateWeeklyPlan(config, state.activeClient, weeklyGoal);

        state.state = "pauta_proposta";
        state.lastIntent = detected.intent;
        state.lastWeeklyGoal = weeklyGoal;
        state.lastPlan = plan;
        state.lastCopy = null;
        state.lastDesign = null;
        state.lastReview = null;
        state.lastGeneratedContent = null;
        state.currentWeekId = productionStore.getCurrentWeekId();
        state.pendingApproval = "gerar_posts_completos";
        await productionStore.savePlan(state.activeClient, state.currentWeekId, plan);
        await sessionStore.saveState(state);

        return { text: plan, showThinking: true };
      }

      if ((detected.intent === "aprovar_pauta" || wantsGenerateFullPosts(message)) && state.pendingApproval === "gerar_posts_completos") {
        const approvedPlan = state.lastPlan || "Pauta aprovada pelo usuario.";
        const weeklyGoal = state.lastWeeklyGoal || "conteudo semanal";
        const generatedPackage = await generateFullPostPackage(config, state.activeClient, weeklyGoal, approvedPlan);

        state.state = "posts_gerados";
        state.lastCopy = generatedPackage.copy;
        state.lastDesign = generatedPackage.design;
        state.lastReview = generatedPackage.review;
        state.lastGeneratedContent = generatedPackage.content;
        state.pendingApproval = null;
        await saveGeneratedProductionPackage(
          productionStore,
          state,
          generatedPackage.copy,
          generatedPackage.design,
          generatedPackage.review,
          generatedPackage.content,
          productionDays(),
          extractDaySection
        );
        await sessionStore.saveState(state);

        return { text: buildGeneratedSummary(), showThinking: true };
      }
      const imageDay = requestedDay || (state.lastImage && wantsImageAdjustment(message) ? { key: "ultima", label: state.lastImage.dayLabel } : null);

      if (imageDay && (wantsGenerateImage(message) || wantsImageAdjustment(message)) && state.lastDesign) {
        if (state.preferences.avoidImages && !wantsForceImageGeneration(message) && !wantsImageAdjustment(message)) {
          await sessionStore.saveState(state);
          return {
            text: [
              "Voce esta com preferencia de evitar imagens ativa.",
              "",
              "Para nao gastar chamada de imagem sem querer, confirme com uma frase explicita, tipo:",
              `gerar imagem de ${imageDay.label.toLowerCase().replace("-feira", "")} mesmo assim`
            ].join("\n")
          };
        }

        const response = buildImageGenerationRequest(state, imageDay.label, message, extractDaySection, extractFieldValue);
        await sessionStore.saveState(state);

        return response;
      }

      if (detected.intent === "aprovar_pauta" && state.lastGeneratedContent) {
        await sessionStore.saveState(state);
        return { text: buildGeneratedSummary("Esse pacote ja foi gerado e esta salvo.") };
      }

      if (detected.intent === "ajustar_conteudo" && requestedDay) {
        const isDesignRevision = wantsDesign(message);
        const source = isDesignRevision ? state.lastDesign : state.lastCopy;

        if (!source) {
          return { text: "Ainda nao tenho conteudo salvo para ajustar. Primeiro gere uma semana de conteudo." };
        }

        const currentSection = extractDaySection(source, requestedDay.label);
        if (!currentSection) {
          return { text: `Nao encontrei a secao de ${requestedDay.label} para ajustar.` };
        }

        const revised = await reviseDayContent(
          config,
          state.activeClient,
          isDesignRevision ? "design" : "copy",
          requestedDay.label,
          currentSection,
          message
        );

        state.pendingRevision = {
          kind: isDesignRevision ? "design" : "copy",
          dayLabel: requestedDay.label,
          content: revised
        };
        state.pendingApproval = "salvar_revisao";
        await sessionStore.saveState(state);

        return {
          text: [
            `Ajustei ${isDesignRevision ? "o design" : "o texto"} de ${requestedDay.label}.`,
            "",
            revised,
            "",
            "Se estiver bom, responda: aprovado",
            "Se quiser mudar algo, me diga o ajuste."
          ].join("\n"),
          showThinking: true
        };
      }

      if (requestedDay && wantsCopy(message) && state.lastCopy) {
        await sessionStore.saveState(state);
        return { text: buildDaySectionResponse("Textos", requestedDay.label, state.lastCopy) };
      }

      if (requestedDay && wantsDesign(message) && state.lastDesign) {
        await sessionStore.saveState(state);
        return { text: buildDaySectionResponse("Design", requestedDay.label, state.lastDesign) };
      }

      if (requestedDay && state.lastCopy && !wantsReview(message)) {
        await sessionStore.saveState(state);
        return { text: buildDaySectionResponse("Textos", requestedDay.label, state.lastCopy) };
      }

      if (wantsCopy(message) && state.lastCopy) {
        await sessionStore.saveState(state);
        return { text: buildCopySummary(state.lastCopy) };
      }

      if (wantsDesign(message) && state.lastDesign) {
        await sessionStore.saveState(state);
        return { text: buildDesignSummary(state.lastDesign) };
      }

      if (wantsReview(message) && state.lastReview) {
        await sessionStore.saveState(state);
        return { text: buildReviewSummary(state.lastReview) };
      }

      if (wantsFullPackage(message) && state.lastGeneratedContent) {
        await sessionStore.saveState(state);
        return { text: [
          "Vou mandar o pacote completo em partes. Pode ficar grande.",
          state.lastGeneratedContent
        ].join("\n\n") };
      }

      if (wantsLastGeneratedContent(message) && state.lastGeneratedContent) {
        await sessionStore.saveState(state);
        return { text: buildGeneratedSummary("Tenho um pacote gerado e salvo.") };
      }

      if (detected.intent === "ajustar_conteudo") {
        return { text: "Claro. Me diga qual post voce quer ajustar e a direcao desejada, por exemplo: \"deixa o reel de quarta mais humano e menos tecnico\"." };
      }

      if (state.taskMemory && wantsDesignFromCurrentTask(message)) {
        if (state.taskMemory.kind === "one_off_design" && state.taskMemory.status !== "draft") {
          await sessionStore.saveState(state);
          return {
            text: buildOneOffApprovalResponse(
              state,
              "A direcao visual desse post ja esta aprovada."
            )
          };
        }

        const response = await generateOneOffTask(
          config,
          state,
          {
            kind: "one_off_design",
            clientSlug: state.taskMemory.clientSlug,
            userRequest: [
              message,
              "",
              "Use este conteudo aprovado como base:",
              state.taskMemory.content
            ].join("\n")
          },
          oneOffStore
        );
        await sessionStore.saveState(state);

        return response;
      }

      if (state.taskMemory && wantsPostFromCurrentTask(message)) {
        const response = await generateOneOffTask(
          config,
          state,
          {
            kind: "one_off_post",
            clientSlug: state.taskMemory.clientSlug,
            userRequest: [
              message,
              "",
              "Use este conteudo aprovado como base:",
              state.taskMemory.content
            ].join("\n")
          },
          oneOffStore
        );
        await sessionStore.saveState(state);

        return response;
      }

      let oneOffRequest = detectOneOffRequest(message, state.activeClient || getDefaultClientSlug(clientSlugs), clientSlugs, detectClientSlug);
      if (oneOffRequest) {
        if (oneOffRequest.clientSlug !== state.activeClient) {
          switchActiveClient(state, oneOffRequest.clientSlug, await resolveWeekIdForClient(productionStore, oneOffRequest.clientSlug));
        }

        const reusableResearchSummary = wantsReuseLastResearch(message)
          ? getReusableResearchSummary(state, oneOffRequest.clientSlug)
          : null;

        if (reusableResearchSummary) {
          oneOffRequest = {
            ...oneOffRequest,
            userRequest: buildResearchEnhancedRequest(oneOffRequest.userRequest, reusableResearchSummary)
          };
        } else if (shouldUseResearch(message)) {
          await runResearch(config, state, oneOffRequest.clientSlug, message);
          if (state.research.lastResearch?.summary) {
            oneOffRequest = {
              ...oneOffRequest,
              userRequest: buildResearchEnhancedRequest(oneOffRequest.userRequest, state.research.lastResearch.summary)
            };
          }
        }

        const response = await generateOneOffTask(config, state, oneOffRequest, oneOffStore);
        await sessionStore.saveState(state);

        return response;
      }

      const quickConversation = buildQuickConversationResponse(message, state);
      if (quickConversation) {
        await sessionStore.saveState(state);
        return { text: quickConversation };
      }

      const routed = await tryAIRouter(config, productionStore, state, message);
      if (routed) {
        routed.text = await composeOperationalResponse(config, state, message, routed.text);
        await sessionStore.saveState(state);
        return routed;
      }

      if (detected.intent === "duvida_geral") {
        const context = await loadClientContext(config.agentKnowledgeDir, state.activeClient);
        const answer = await generateText(config, buildConversationPrompt(context, state, message));
        await sessionStore.saveState(state);

        return { text: answer, showThinking: true };
      }

      await sessionStore.saveState(state);

      return { text: buildNextStepResponse(state) };
    }
  };
}

function buildGeneratedSummary(prefix = "A agencia terminou a primeira versao."): string {
  return [
    prefix,
    "",
    "Gerei e salvei:",
    "- textos dos posts pelo Copywriter",
    "- direcao visual e prompts pelo Designer",
    "- revisao editorial pelo Revisor",
    "",
    "O Revisor marcou como aprovado com ajustes.",
    "",
    "O que voce quer ver agora?",
    "- textos",
    "- design",
    "- revisao",
    "- pacote completo"
  ].join("\n");
}

function buildCopySummary(copy: string): string {
  return [
    "Textos salvos pelo Copywriter.",
    "",
    extractHeadings(copy).slice(0, 5).join("\n"),
    "",
    "Quer ver qual parte?",
    "- segunda",
    "- terca",
    "- quarta",
    "- quinta",
    "- sexta",
    "- textos completos"
  ].join("\n");
}

function buildDesignSummary(design: string): string {
  const coverLines = extractMatchingLines(design, "**Texto da capa:**", 5);

  return [
    "Direcao visual salva pelo Designer.",
    "",
    "Capas sugeridas:",
    ...(coverLines.length > 0 ? coverLines : ["- Encontrei a direcao visual, mas nao consegui resumir as capas automaticamente."]),
    "",
    "Quer ver qual parte?",
    "- design segunda",
    "- design terca",
    "- design quarta",
    "- design quinta",
    "- design sexta",
    "- design completo"
  ].join("\n");
}

function buildReviewSummary(review: string): string {
  const result = extractSectionFirstLine(review, "## Resultado Geral") || "Resultado: revisar detalhes.";
  const risks = extractSectionBullets(review, "## Riscos", 3);

  return [
    "Resumo da revisao editorial:",
    "",
    result,
    "",
    "Principais riscos/ajustes:",
    ...(risks.length > 0 ? risks : ["- O revisor deixou observacoes, mas nao consegui resumir automaticamente."]),
    "",
    "Se quiser, mande: revisao completa"
  ].join("\n");
}

function buildOneOffApprovalResponse(state: UserState, baseText: string): string {
  const task = state.taskMemory;
  if (!task) return baseText;

  const options =
    task.kind === "one_off_copy"
      ? [
          "criar uma arte para esse post",
          "transformar em carrossel",
          "ver os avulsos salvos",
          "criar outra legenda"
        ]
      : task.visualPrompt
        ? [
            "gerar a imagem",
            "ajustar o design",
            "ver os avulsos salvos",
            "criar outra ideia"
          ]
        : [
            "ver os avulsos salvos",
            "criar outra ideia",
            "montar a semana"
          ];

  return [
    baseText,
    "",
    "Quer agora:",
    ...options.map((option) => `- ${option}`)
  ].join("\n");
}

function buildDaySectionResponse(kind: string, dayLabel: string, markdown: string): string {
  const section = extractDaySection(markdown, dayLabel);

  if (!section) {
    return [
      `Nao encontrei a secao de ${dayLabel} em ${kind.toLowerCase()}.`,
      "",
      "Voce pode tentar:",
      `- ${kind.toLowerCase()} completo`,
      "- textos",
      "- design"
    ].join("\n");
  }

  const nextStep =
    kind === "Design"
      ? `Quer ajustar esse visual ou gerar imagem da capa de ${dayLabel.toLowerCase().replace("-feira", "")}?`
      : "Quer ajustar esse texto ou ver o design desse post?";

  return [`${kind} - ${dayLabel}`, "", section.trim(), "", nextStep].join("\n");
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

async function tryAIRouter(
  config: AppConfig,
  productionStore: ProductionStore,
  state: UserState,
  message: string
): Promise<OrchestratorResponse | null> {
  if (!state.activeClient || !state.currentWeekId) return null;
  if (!state.preferences?.aiRouter) return null;

  await syncStateToProduction(productionStore, state, productionDays(), extractDaySection);
  const weekStatus = await productionStore.getWeekStatus(state.activeClient, state.currentWeekId);
  const action = await routeMessageWithAI(config, message, state, weekStatus);

  if (action.confidence < 0.72 || action.action === "unknown") {
    return null;
  }

  return executeRouterAction(productionStore, state, action);
}

async function composeOperationalResponse(
  config: AppConfig,
  state: UserState,
  userMessage: string,
  rawResponse: string
): Promise<string> {
  if (!state.activeClient) return rawResponse;
  if (!state.preferences?.responseComposer) return rawResponse;
  if (state.preferences?.economyMode) return rawResponse;
  if (!shouldComposeResponse(rawResponse)) return rawResponse;

  try {
    const context = await loadClientContext(config.agentKnowledgeDir, state.activeClient);
    const composed = await generateText(config, buildResponseComposerPrompt(context, state, userMessage, rawResponse));
    const clean = composed.trim();
    return clean.length > 0 ? clean : rawResponse;
  } catch {
    return rawResponse;
  }
}

function shouldComposeResponse(response: string): boolean {
  if (response.length > 1200) return false;
  if (response.includes("# ")) return false;
  if (response.includes("## ")) return false;
  if (response.includes("Prompt visual")) return false;
  if (response.includes("Isso vai consumir uma chamada de imagem")) return false;
  if (response.includes("Gerei e salvei:")) return false;
  return true;
}

function applyPreferenceMessage(message: string, state: UserState): string | null {
  const text = normalizeMessage(message);

  if (
    text.includes("modo economia") ||
    text.includes("economizar token") ||
    text.includes("economizar tokens") ||
    text.includes("nao gastar token") ||
    text.includes("nao gastar tokens") ||
    text.includes("gastar menos token") ||
    text.includes("gastar menos tokens")
  ) {
    state.preferences = {
      ...state.preferences,
      economyMode: true,
      avoidImages: true,
      responseComposer: false,
      aiRouter: true
    };

    return [
      "Modo economia ativado.",
      "",
      "Vou evitar chamadas extras para deixar respostas mais bonitas, nao vou sugerir imagem como proximo passo e so vou usar o roteador com IA quando as regras simples nao resolverem.",
      "Para voltar ao modo mais natural, diga: modo completo."
    ].join("\n");
  }

  if (
    text.includes("modo completo") ||
    text.includes("modo natural") ||
    text.includes("pode usar ia") ||
    text.includes("pode gastar token") ||
    text.includes("pode gastar tokens")
  ) {
    state.preferences = {
      ...state.preferences,
      economyMode: false,
      responseComposer: true,
      aiRouter: true
    };

    return "Modo completo ativado. Vou manter o roteador inteligente e respostas mais naturais quando fizer sentido.";
  }

  if (
    text.includes("nao quero gerar imagem") ||
    text.includes("nao quero gerar imagens") ||
    text.includes("evitar imagem") ||
    text.includes("evitar imagens") ||
    text.includes("sem imagem") ||
    text.includes("sem imagens")
  ) {
    state.preferences = {
      ...state.preferences,
      avoidImages: true
    };

    return "Combinado. Vou evitar gerar ou sugerir imagens, a menos que voce peca explicitamente para abrir excecao.";
  }

  if (
    text.includes("pode gerar imagem") ||
    text.includes("pode gerar imagens") ||
    text.includes("liberar imagem") ||
    text.includes("liberar imagens")
  ) {
    state.preferences = {
      ...state.preferences,
      avoidImages: false
    };

    return "Fechado. Imagens liberadas novamente, sempre com confirmacao antes de gastar a chamada.";
  }

  if (text.includes("desligar roteador") || text.includes("sem roteador inteligente")) {
    state.preferences = {
      ...state.preferences,
      aiRouter: false
    };

    return "Roteador inteligente desligado. Vou responder apenas pelos fluxos diretos e pela conversa geral.";
  }

  if (text.includes("ligar roteador") || text.includes("usar roteador inteligente")) {
    state.preferences = {
      ...state.preferences,
      aiRouter: true
    };

    return "Roteador inteligente ligado novamente.";
  }

  if (text.includes("desligar composer") || text.includes("sem resposta bonita")) {
    state.preferences = {
      ...state.preferences,
      responseComposer: false
    };

    return "Composer desligado. Vou responder de forma mais direta para economizar uma chamada extra.";
  }

  if (text.includes("ligar composer") || text.includes("resposta mais natural")) {
    state.preferences = {
      ...state.preferences,
      responseComposer: true,
      economyMode: false
    };

    return "Composer ligado. Vou deixar respostas operacionais curtas mais naturais quando fizer sentido.";
  }

  if (text.includes("modo leigo") || text.includes("modo simples") || text.includes("modo iniciante")) {
    state.preferences = {
      ...state.preferences,
      beginnerMode: true
    };

    return "Modo leigo ligado. Vou evitar termos tecnicos e sugerir proximos passos em linguagem simples.";
  }

  if (text.includes("modo tecnico") || text.includes("modo técnico") || text.includes("modo avancado") || text.includes("modo avançado")) {
    state.preferences = {
      ...state.preferences,
      beginnerMode: false
    };

    return "Modo tecnico ligado. Posso mostrar mais detalhes de fluxo, status e estrutura quando fizer sentido.";
  }

  if (text.includes("preferencias") || text.includes("preferÃªncias") || text.includes("configuracao do bot") || text.includes("configuraÃ§Ã£o do bot")) {
    return [
      "Preferencias atuais:",
      `- modo economia: ${state.preferences.economyMode ? "ligado" : "desligado"}`,
      `- evitar imagens: ${state.preferences.avoidImages ? "sim" : "nao"}`,
      `- roteador IA: ${state.preferences.aiRouter ? "ligado" : "desligado"}`,
      `- composer: ${state.preferences.responseComposer ? "ligado" : "desligado"}`,
      `- modo leigo: ${state.preferences.beginnerMode ? "ligado" : "desligado"}`
    ].join("\n");
  }

  return null;
}

async function executeRouterAction(
  productionStore: ProductionStore,
  state: UserState,
  action: RouterAction
): Promise<OrchestratorResponse | null> {
  if (!state.activeClient || !state.currentWeekId) return null;

  if (action.action === "production_status") {
    return { text: await getProductionStatusText(productionStore, state, state.preferences?.avoidImages), showThinking: true };
  }

  if (action.action === "show_day_package") {
    return {
      text: await readProductionDayPackageText(productionStore, state, action.dayLabel),
      showThinking: true
    };
  }

  if (action.action === "approve_parts") {
    const results: string[] = [];
    for (const part of action.parts) {
      results.push(await approveProductionPartText(productionStore, state, action.dayLabel, part, state.preferences?.avoidImages));
    }

    return { text: results.join("\n\n---\n\n"), showThinking: true };
  }

  if (action.action === "generate_image") {
    if (state.preferences?.avoidImages) {
      return {
        text: [
          "Entendi o pedido de imagem, mas a preferencia atual e evitar imagens para economizar.",
          "",
          "Se quiser abrir excecao, diga explicitamente: gerar imagem mesmo assim."
        ].join("\n"),
        showThinking: true
      };
    }

    return buildImageGenerationRequest(
      state,
      action.dayLabel,
      "Pedido interpretado por linguagem natural.",
      extractDaySection,
      extractFieldValue
    );
  }

  if (action.action === "generate_full_posts") {
    if (state.pendingApproval === "gerar_posts_completos") {
      return null;
    }

    return {
      text: [
        "Para gerar os posts completos, preciso de uma pauta aprovada em aberto.",
        "",
        state.lastPlan
          ? "Ja existe uma pauta salva, mas ela nao esta aguardando aprovacao. Se quiser recomecar, diga: criar nova pauta."
          : `Primeiro me peca para montar a semana de ${formatClientName(state.activeClient)}.`
      ].join("\n"),
      showThinking: true
    };
  }

  if (action.action === "next_step") {
    return { text: buildNextStepResponse(state), showThinking: true };
  }

  return null;
}

function extractDaySection(markdown: string, dayLabel: string): string | null {
  const normalizedDay = normalizeMessage(dayLabel);
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => isDaySectionHeading(line, normalizedDay));

  if (start === -1) return null;

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index++) {
    const line = lines[index];
    if (/^##\s+/.test(line)) {
      end = index;
      break;
    }
  }

  return lines.slice(start, end).join("\n");
}

function extractFieldValue(markdown: string, marker: string): string | null {
  const lines = markdown.split("\n");
  const markerIndex = lines.findIndex((line) => line.trim() === marker);
  if (markerIndex === -1) return null;

  const valueLines: string[] = [];
  for (const line of lines.slice(markerIndex + 1)) {
    if (/^\*\*.+:\*\*/.test(line.trim()) || /^##\s+/.test(line)) {
      break;
    }
    if (line.trim().length > 0) {
      valueLines.push(line.trim());
    }
  }

  return valueLines.join(" ").trim() || null;
}

function replaceDaySection(markdown: string, dayLabel: string, replacement: string): string {
  const normalizedDay = normalizeMessage(dayLabel);
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => isDaySectionHeading(line, normalizedDay));

  if (start === -1) {
    return markdown;
  }

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index++) {
    if (/^##\s+/.test(lines[index])) {
      end = index;
      break;
    }
  }

  return [...lines.slice(0, start), replacement.trim(), ...lines.slice(end)].join("\n");
}

function isDaySectionHeading(line: string, normalizedDay: string): boolean {
  const normalizedLine = normalizeMessage(line.replace(/^#+\s*/, ""));

  if (normalizedLine.startsWith(normalizedDay)) return true;

  return /^##\s+/.test(line) && normalizedLine.includes(normalizedDay);
}

function detectWeekday(message: string): { key: string; label: string } | null {
  const text = normalizeMessage(message);
  const days = [
    { key: "segunda", label: "Segunda-feira" },
    { key: "terca", label: "Terca-feira" },
    { key: "terÃ§a", label: "Terca-feira" },
    { key: "quarta", label: "Quarta-feira" },
    { key: "quinta", label: "Quinta-feira" },
    { key: "sexta", label: "Sexta-feira" }
  ];

  return days.find((day) => text.includes(day.key)) || null;
}

function productionDays(): Array<{ key: string; label: string }> {
  return [
    { key: "segunda", label: "Segunda-feira" },
    { key: "terca", label: "Terca-feira" },
    { key: "quarta", label: "Quarta-feira" },
    { key: "quinta", label: "Quinta-feira" },
    { key: "sexta", label: "Sexta-feira" }
  ];
}

function extractHeadings(markdown: string): string[] {
  return markdown
    .split("\n")
    .filter((line) => /^##\s+/.test(line))
    .map((line) => `- ${line.replace(/^##\s+/, "").trim()}`);
}

function extractMatchingLines(markdown: string, marker: string, limit: number): string[] {
  const lines = markdown.split("\n");
  const matches: string[] = [];

  for (let index = 0; index < lines.length; index++) {
    if (lines[index].trim() === marker) {
      const next = lines[index + 1]?.trim();
      if (next) {
        matches.push(`- ${next}`);
      }
    }
    if (matches.length >= limit) break;
  }

  return matches;
}

function extractSectionFirstLine(markdown: string, heading: string): string | null {
  const lines = markdown.split("\n");
  const headingIndex = lines.findIndex((line) => line.trim() === heading);
  if (headingIndex === -1) return null;

  return lines.slice(headingIndex + 1).find((line) => line.trim().length > 0)?.trim() || null;
}

function extractSectionBullets(markdown: string, heading: string, limit: number): string[] {
  const lines = markdown.split("\n");
  const headingIndex = lines.findIndex((line) => line.trim() === heading);
  if (headingIndex === -1) return [];

  const bullets: string[] = [];
  for (const line of lines.slice(headingIndex + 1)) {
    if (line.startsWith("## ")) break;
    if (line.trim().startsWith("- ")) bullets.push(line.trim());
    if (bullets.length >= limit) break;
  }
  return bullets;
}

function normalizeMessage(message: string): string {
  return message
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();
}

function buildQuickConversationResponse(message: string, state: NextStepState): string | null {
  const text = normalizeMessage(message);

  if (/^(oi|ola|olÃ¡|e ai|eae|bom dia|boa tarde|boa noite)(\s|$)/.test(text)) {
    return `Oi! Estou por aqui. ${buildNextStepResponse(state)}`;
  }

  if (
    text.includes("proximo passo") ||
    text.includes("proxima etapa") ||
    text.includes("continuar") ||
    text.includes("vamos continuar") ||
    text === "vamos" ||
    text === "bora"
  ) {
    return buildNextStepResponse(state);
  }

  if (
    text.includes("o que voce faz") ||
    text.includes("como funciona") ||
    text.includes("me ajuda com o que") ||
    text.includes("o que da pra fazer")
  ) {
    return [
      "Eu funciono como uma agencia de marketing no Telegram.",
      "",
      "Posso montar calendario semanal, criar textos, revisar, gerar direcao visual e preparar imagem de capa/post com sua aprovacao.",
      "",
      buildNextStepResponse(state)
    ].join("\n");
  }

  return null;
}

function buildNextStepResponse(state: NextStepState): string {
  if (state.pendingApproval === "gerar_posts_completos") {
    return "A pauta esta pronta. Se estiver boa, responda aprovado para eu acionar Copywriter, Designer e Revisor.";
  }

  if (state.pendingApproval === "salvar_revisao") {
    return "Tenho uma revisao pendente. Se ficou boa, responda aprovado. Se quiser mudar, me diga o ajuste.";
  }

  if (state.pendingApproval === "gerar_imagem") {
    return "Tenho uma imagem pronta para gerar. Se quiser consumir a chamada de imagem, responda aprovado.";
  }

  if (state.lastImage?.status === "draft") {
    return `A ultima imagem foi gerada para ${state.lastImage.dayLabel}. Voce pode aprovar ou pedir ajuste, por exemplo: refaz mais minimalista.`;
  }

  if (state.taskMemory?.status === "draft") {
    return "Tenho uma tarefa avulsa em rascunho. Se ficou boa, responda aprovado. Se quiser mudar, me diga o ajuste.";
  }

  if (state.taskMemory?.visualPrompt && state.taskMemory.status === "ready_for_image") {
    return state.preferences?.avoidImages
      ? "Tenho um prompt visual avulso aprovado. Como imagens estao em economia, so vou gerar se voce pedir explicitamente."
      : "Tenho um prompt visual avulso aprovado. Posso gerar a imagem quando voce quiser.";
  }

  if (state.lastGeneratedContent) {
    if (state.preferences?.avoidImages) {
      return "Temos um pacote salvo. Como voce esta evitando imagens, eu seguiria revisando e aprovando textos/designs antes de pensar em capa.";
    }

    return "Temos um pacote salvo. Voce pode pedir textos, design, revisao, pacote completo ou gerar imagem da capa de um dia.";
  }

  if (state.lastDesign) {
    if (state.preferences?.avoidImages) {
      return "Temos direcao visual salva. Como imagens estao em economia, voce pode pedir o design de um dia ou aprovar texto/design.";
    }

    return "Temos direcao visual salva. Voce pode pedir design de um dia ou gerar imagem da capa.";
  }

  if (state.state === "pauta_proposta") {
    return "Temos uma pauta proposta. Se estiver boa, responda aprovado para gerar os posts completos.";
  }

  return `Quer montar a semana de ${formatClientName(state.activeClient || "cliente")}, revisar algum post ou gerar uma imagem?`;
}

function wantsCopy(message: string): boolean {
  const text = normalizeMessage(message);
  return (
    text === "textos" ||
    text.includes("mostra os textos") ||
    text.includes("mostre os textos") ||
    text.includes("copywriter") ||
    text.includes("legendas") ||
    text.includes("posts completos")
  );
}

function wantsDesign(message: string): boolean {
  const text = normalizeMessage(message);
  return (
    text === "design" ||
    text.includes("design") ||
    text.includes("direcao visual") ||
    text.includes("prompts visuais") ||
    text.includes("designer") ||
    text.includes("capas")
  );
}

function wantsReview(message: string): boolean {
  const text = normalizeMessage(message);
  return (
    text === "revisao" ||
    text.includes("revisor") ||
    text.includes("ajustes") ||
    text.includes("pontos fortes") ||
    text.includes("riscos")
  );
}

function wantsGenerateImageFromCurrentTask(message: string, state: UserState): boolean {
  if (wantsGenerateImage(message) || wantsImageAdjustment(message)) return true;
  if (!state.taskMemory?.visualPrompt) return false;
  if (state.taskMemory.status !== "ready_for_image" && state.taskMemory.status !== "image_generated") return false;

  const text = normalizeMessage(message);
  return (
    text === "gera" ||
    text === "gerar" ||
    text === "pode" ||
    text === "pode gerar" ||
    text === "sim" ||
    text === "manda" ||
    text === "manda gerar" ||
    text === "vai" ||
    text === "bora" ||
    text.includes("entao gera") ||
    text.includes("então gera") ||
    text.includes("pode fazer")
  );
}
function wantsGenerateImage(message: string): boolean {
  const text = normalizeMessage(message);
  return (
    text.includes("gerar imagem") ||
    text.includes("gera imagem") ||
    text.includes("gere imagem") ||
    text.includes("gerar essa imagem") ||
    text.includes("gera essa imagem") ||
    text.includes("gere essa imagem") ||
    text.includes("criar imagem") ||
    text.includes("cria imagem") ||
    text.includes("crie imagem") ||
    text.includes("gerar capa") ||
    text.includes("gera capa") ||
    text.includes("gere capa") ||
    text.includes("gerar essa capa") ||
    text.includes("gera essa capa") ||
    text.includes("gere essa capa") ||
    text.includes("criar capa") ||
    text.includes("cria capa") ||
    text.includes("crie capa") ||
    text.includes("imagem da capa") ||
    text.includes("capa de")
  );
}

function wantsDesignFromCurrentTask(message: string): boolean {
  const text = normalizeMessage(message);
  return (
    text.includes("criar arte") ||
    text.includes("cria arte") ||
    text.includes("fazer arte") ||
    text.includes("faz arte") ||
    text.includes("direcao visual para esse") ||
    text.includes("design para esse") ||
    text.includes("capa para esse") ||
    text.includes("arte para esse")
  );
}

function wantsPostFromCurrentTask(message: string): boolean {
  const text = normalizeMessage(message);
  return (
    text.includes("transformar em carrossel") ||
    text.includes("transforma em carrossel") ||
    text.includes("virar carrossel") ||
    text.includes("faz carrossel") ||
    text.includes("cria carrossel") ||
    text.includes("post completo com isso") ||
    text.includes("transformar em post")
  );
}
function wantsForceImageGeneration(message: string): boolean {
  const text = normalizeMessage(message);
  return (
    text.includes("mesmo assim") ||
    text.includes("abrir excecao") ||
    text.includes("abrir exceÃ§Ã£o") ||
    text.includes("pode gastar imagem") ||
    text.includes("pode gastar a imagem") ||
    text.includes("pode gerar") ||
    text.includes("manda gerar") ||
    text.includes("gerar imagem agora") ||
    text.includes("gera essa imagem") ||
    text.includes("gerar essa imagem") ||
    text.includes("gere essa imagem") ||
    text.includes("quero que gere") ||
    text.includes("aprovei o prompt") ||
    text.includes("aprovei esse prompt")
  );
}

function wantsTaskMemoryStatus(message: string): boolean {
  const text = normalizeMessage(message);
  return (
    text.includes("ultima tarefa") ||
    text.includes("tarefa atual") ||
    text.includes("pedido atual") ||
    text.includes("ultimo pedido") ||
    text.includes("prompt aprovado") ||
    text.includes("qual prompt")
  );
}

function wantsTaskFullContent(message: string): boolean {
  const text = normalizeMessage(message);
  return (
    text === "ver completo" ||
    text === "mostrar completo" ||
    text === "mostra completo" ||
    text.includes("ver tarefa completa") ||
    text.includes("mostra tarefa completa") ||
    text.includes("conteudo completo da tarefa") ||
    text.includes("post completo avulso")
  );
}

function detectOneOffViewPosition(message: string): number | null {
  const text = normalizeMessage(message);
  const match = text.match(/(?:ver|abrir|mostrar|mostra)\s+(?:o\s+)?avulso\s+(\d+)/);
  if (!match) return null;

  const position = Number(match[1]);
  return Number.isInteger(position) && position > 0 ? position : null;
}

function wantsUsageStatus(message: string): boolean {
  const text = normalizeMessage(message);
  return (
    text === "uso" ||
    text === "gastos" ||
    text === "custos" ||
    text.includes("uso do mes") ||
    text.includes("gastos do mes") ||
    text.includes("quanto gastei") ||
    text.includes("quanto usei")
  );
}

function wantsOneOffList(message: string): boolean {
  const text = normalizeMessage(message);
  return (
    text === "avulsos" ||
    text.includes("avulsos da") ||
    text.includes("avulsos do") ||
    text.includes("posts avulsos") ||
    text.includes("listar avulsos") ||
    text.includes("lista avulsos") ||
    text.includes("tarefas avulsas")
  );
}

function buildUsageStatusText(state: UserState): string {
  const researchUsed = state.research?.used || 0;
  const images = state.usage?.imageGenerations || 0;
  const oneOffTasks = state.usage?.oneOffTasks || 0;
  const estimatedResearchCost = researchUsed * 0.03;
  const estimatedImageCostLow = images * 0.10;
  const estimatedImageCostHigh = images * 0.50;

  return [
    "Uso estimado do mes:",
    `- pesquisas: ${researchUsed}/${state.research?.monthlyLimit || 10}`,
    `- imagens geradas: ${images}`,
    `- tarefas avulsas criadas: ${oneOffTasks}`,
    "",
    "Estimativa bem aproximada:",
    `- pesquisas: ~US$${estimatedResearchCost.toFixed(2)}`,
    `- imagens: ~US$${estimatedImageCostLow.toFixed(2)} a US$${estimatedImageCostHigh.toFixed(2)}`,
    "",
    "Obs: isso e estimativa local. O valor exato continua sendo o dashboard da OpenAI."
  ].join("\n");
}

function wantsProductionStatus(message: string): boolean {
  const text = normalizeMessage(message);
  return (
    text.includes("status da semana") ||
    text.includes("status dos posts") ||
    text.includes("o que falta") ||
    text.includes("faltando") ||
    text.includes("falta aprovar") ||
    text.includes("qual falta") ||
    text.includes("andamento da semana")
  );
}

function wantsStorageDebug(message: string): boolean {
  const text = normalizeMessage(message);
  return text === "debug storage" || text === "debug dados" || text === "debug data";
}

function wantsProductionDayPackage(message: string): boolean {
  const text = normalizeMessage(message);
  return (
    text.includes("mostra post") ||
    text.includes("mostre post") ||
    text.includes("pacote do post") ||
    text.includes("pacote de") ||
    text.includes("post de") ||
    text.includes("post da")
  );
}

function wantsProductionApproval(message: string): boolean {
  const text = normalizeMessage(message);
  return (
    (text.includes("aprovar") || text.includes("aprova") || text.includes("aprove")) &&
    (text.includes("post") || text.includes("texto") || text.includes("copy") || text.includes("design") || text.includes("imagem") || text.includes("capa"))
  );
}

function wantsGenerateFullPosts(message: string): boolean {
  const text = normalizeMessage(message);
  return (
    text.includes("gerar posts completos") ||
    text.includes("gera posts completos") ||
    text.includes("continuar producao") ||
    text.includes("continuar produÃ§Ã£o") ||
    text.includes("produzir posts") ||
    text.includes("gerar pacote")
  );
}

function detectProductionApprovalPart(message: string): ProductionApprovalPart {
  const text = normalizeMessage(message);
  if (text.includes("texto") || text.includes("copy") || text.includes("legenda")) return "copy";
  if (text.includes("design") || text.includes("visual")) return "design";
  if (text.includes("imagem") || text.includes("capa")) return "image";
  return "post";
}

function wantsNewProduction(message: string): boolean {
  const text = normalizeMessage(message);
  return (
    text.includes("nova pauta") ||
    text.includes("novo calendario") ||
    text.includes("nova semana") ||
    text.includes("criar nova") ||
    text.includes("gerar nova") ||
    text.includes("refazer semana") ||
    text.includes("recomecar")
  );
}

function wantsImageAdjustment(message: string): boolean {
  const text = normalizeMessage(message);
  return (
    text.includes("refaz") ||
    text.includes("refaca") ||
    text.includes("nao gostei") ||
    text.includes("mais minimalista") ||
    text.includes("mais clean") ||
    text.includes("mais limpo") ||
    text.includes("menos cheia") ||
    text.includes("menos poluida") ||
    text.includes("menos infantil") ||
    text.includes("mais editorial") ||
    text.includes("mais profissional") ||
    text.includes("menos generico") ||
    text.includes("sem icone") ||
    text.includes("sem icones") ||
    text.includes("sem clipart") ||
    text.includes("ajusta a imagem") ||
    text.includes("ajustar imagem") ||
    text.includes("ajusta a capa") ||
    text.includes("ajustar capa")
  );
}

function wantsFullPackage(message: string): boolean {
  const text = normalizeMessage(message);
  return (
    text.includes("pacote completo") ||
    text.includes("manda tudo") ||
    text.includes("envia tudo") ||
    text.includes("mostra tudo") ||
    text.includes("mostre tudo") ||
    text.includes("conteudo completo")
  );
}

function wantsLastGeneratedContent(message: string): boolean {
  const text = normalizeMessage(message);

  return (
    text.includes("reenviar") ||
    text.includes("reenvia") ||
    text.includes("envia de novo") ||
    text.includes("mande de novo") ||
    text.includes("manda de novo") ||
    text.includes("manda de novo") ||
    text.includes("mostre o pacote") ||
    text.includes("mostrar pacote") ||
    text.includes("mostra o pacote") ||
    text.includes("mostre o resultado") ||
    text.includes("mostra o resultado") ||
    text.includes("ultimo conteudo") ||
    text.includes("ultima geracao") ||
    text.includes("resultado") ||
    text.includes("pacote gerado") ||
    text.trim() === "pacote"
  );
}










function buildOneOffImageInstruction(message: string, state: UserState): string { return ["Gerar/refazer imagem final com padrao editorial profissional.", `Pedido atual do usuario: ${message.trim() || "gerar imagem aprovada"}`, "Evitar completamente: icones infantis, clipart, emojis, carinhas, estrelas de avaliacao, mascotes, graficos fake exagerados e aparencia de Canva generico.", "Preferir: grid editorial, tipografia refinada e legivel, hierarquia limpa, respiro, poucos elementos abstratos, contraste elegante e composicao com cara de marca pessoal/consultoria.", wantsImageAdjustment(message) ? "Refazer a imagem anterior mantendo o mesmo texto aprovado e corrigindo a direcao visual conforme o pedido do usuario." : null].filter(Boolean).join("\n"); }
