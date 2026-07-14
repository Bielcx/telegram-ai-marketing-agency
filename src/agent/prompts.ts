import type { ClientContext } from "../clients/loader.js";
import type { UserState } from "./state.js";

export function buildPlanPrompt(context: ClientContext, weeklyGoal: string): string {
  return [
    context.promptBase,
    context.agents.strategist,
    context.profile,
    context.authorMemory,
    "Tarefa do Estrategista de Calendario: proponha uma pauta semanal resumida antes de gerar os posts completos.",
    `Cliente: ${context.slug}`,
    `Objetivo da semana: ${weeklyGoal}`,
    "Responda de forma curta, com os 5 dias da semana e pergunte se pode gerar os posts completos."
  ].join("\n\n---\n\n");
}

export function buildCopyPrompt(context: ClientContext, weeklyGoal: string, approvedPlan: string): string {
  return [
    context.promptBase,
    context.agents.copywriter,
    context.profile,
    context.authorMemory,
    "Tarefa do Copywriter: gere os textos completos da semana a partir da pauta aprovada.",
    `Cliente: ${context.slug}`,
    `Objetivo da semana: ${weeklyGoal}`,
    `Pauta aprovada:\n${approvedPlan}`
  ].join("\n\n---\n\n");
}

export function buildDesignPrompt(context: ClientContext, approvedPlan: string, copy: string): string {
  return [
    context.promptBase,
    context.agents.designer,
    context.profile,
    "Tarefa do Designer: crie direcao visual e prompts visuais para cada post. Nao gere imagem final.",
    "Regra importante para prompts de imagem: sempre informe o texto exato da capa em um campo separado chamado **Texto da capa:**.",
    "O prompt visual deve dizer explicitamente para nao inventar titulo, nao adicionar subtitulo e nao adicionar frases extras, exceto quando o usuario pedir.",
    "Evite direcoes genericas de banco de imagem ou template pronto. Prefira composicao editorial, grid claro, tipografia bem hierarquizada, espaco negativo e poucos elementos com funcao.",
    "Proiba no prompt visual: icones infantis, clipart, emojis, estrelas de avaliacao, carinhas, mascotes, graficos fake exagerados, botao falso, excesso de brilho e qualquer visual com cara de template automatico.",
    `Cliente: ${context.slug}`,
    `Pauta aprovada:\n${approvedPlan}`,
    `Textos criados pelo Copywriter:\n${copy}`
  ].join("\n\n---\n\n");
}

export function buildReviewPrompt(context: ClientContext, approvedPlan: string, copy: string, design: string): string {
  return [
    context.promptBase,
    context.agents.reviewer,
    context.profile,
    context.authorMemory,
    "Tarefa do Revisor: revise estrategia, textos e direcao visual. Aponte riscos e entregue ajustes objetivos.",
    `Cliente: ${context.slug}`,
    `Pauta aprovada:\n${approvedPlan}`,
    `Textos:\n${copy}`,
    `Direcao visual:\n${design}`
  ].join("\n\n---\n\n");
}

export function buildReviseCopyPrompt(context: ClientContext, dayLabel: string, currentSection: string, instruction: string): string {
  return [
    context.promptBase,
    context.agents.copywriter,
    context.profile,
    context.authorMemory,
    "Tarefa do Copywriter: revise apenas a secao indicada, mantendo o restante do calendario intacto.",
    `Cliente: ${context.slug}`,
    `Dia: ${dayLabel}`,
    `Instrucao do usuario: ${instruction}`,
    `Secao atual:\n${currentSection}`,
    "Devolva somente a nova versao da secao revisada, em Markdown."
  ].join("\n\n---\n\n");
}

export function buildReviseDesignPrompt(context: ClientContext, dayLabel: string, currentSection: string, instruction: string): string {
  return [
    context.promptBase,
    context.agents.designer,
    context.profile,
    "Tarefa do Designer: revise apenas a direcao visual indicada, mantendo a identidade visual do cliente.",
    "Mantenha um campo **Texto da capa:** com o texto exato que deve aparecer na imagem.",
    "No **Prompt visual:**, proiba a criacao de titulos, subtitulos ou frases extras que nao estejam no texto da capa.",
    "Se o usuario pedir algo mais profissional, editorial, menos generico ou menos infantil, traduza isso em decisoes concretas: grid, margem, escala tipografica, contraste, poucos elementos e abstracao visual.",
    "Evite no prompt visual: icones infantis, clipart, emojis, estrelas de avaliacao, carinhas, graficos fake exagerados e aparencia de template pronto.",
    `Cliente: ${context.slug}`,
    `Dia: ${dayLabel}`,
    `Instrucao do usuario: ${instruction}`,
    `Secao atual:\n${currentSection}`,
    "Devolva somente a nova versao da secao revisada, em Markdown. Nao gere imagem final."
  ].join("\n\n---\n\n");
}

export function buildOneOffDesignPrompt(context: ClientContext, userRequest: string): string {
  return [
    context.promptBase,
    context.agents.designer,
    context.profile,
    "Tarefa do Diretor de Arte: crie uma direcao visual avulsa para um post de Instagram, sem depender de calendario semanal.",
    "Entenda o pedido natural do usuario e preencha o que faltar com bom senso, usando a identidade do cliente.",
    "Antes do prompt final, proponha 3 caminhos visuais realmente diferentes. Evite palavras vagas como premium, sofisticado e moderno sem explicar a composicao.",
    "Cada caminho deve ter decisao concreta de layout, hierarquia, fundo, elementos, ritmo visual e por que combina com o objetivo.",
    "A direcao precisa parecer trabalho de design para cliente real, nao rascunho generico de IA. Prefira linguagem editorial, composicao limpa, escala tipografica intencional, poucos elementos e bom uso de espaco negativo.",
    "Evite solucoes literais demais. Para temas de metricas, estrategia ou gestao, use formas abstratas, grid editorial, divisorias finas, blocos de conteudo e ritmo visual; nao use estrelas, carinhas, clipart, icones infantis ou graficos fake como elemento principal.",
    "Escolha uma recomendacao principal e use ela para montar o prompt visual final.",
    "Responda em Markdown curto e pratico, com estes campos obrigatorios:",
    "## Design Avulso",
    "**Formato:**",
    "**Tema:**",
    "**Texto da capa:**",
    "**Caminhos visuais:**",
    "1. Nome do caminho - decisao visual concreta",
    "2. Nome do caminho - decisao visual concreta",
    "3. Nome do caminho - decisao visual concreta",
    "**Recomendacao:**",
    "**Direcao visual:**",
    "**Prompt visual:**",
    "**Observacao:**",
    "No campo **Prompt visual:** proiba criar titulos, subtitulos ou frases extras que nao estejam no texto da capa.",
    "No campo **Prompt visual:** inclua tambem proibicoes claras: sem icones infantis, sem clipart, sem emojis, sem estrelas de avaliacao, sem carinhas, sem mascotes, sem visual de template generico e sem elementos decorativos aleatorios.",
    "Nao gere imagem final.",
    `Cliente: ${context.slug}`,
    `Pedido do usuario:\n${userRequest}`
  ].join("\n\n---\n\n");
}

export function buildResearchPrompt(context: ClientContext, topic: string): string {
  return [
    context.promptBase,
    context.agents.socialMediaManager,
    context.profile,
    "Tarefa do Research Agent: pesquise na web para trazer repertorio atual e util para marketing de conteudo.",
    "Use a pesquisa para encontrar ideias, tendencias, angulos, linguagem do mercado e referencias estrategicas.",
    "Nao copie posts nem textos de terceiros. Transforme a pesquisa em insights aplicaveis para o cliente.",
    "Responda em portugues, curto e pratico, com:",
    "## Pesquisa",
    "**Tema pesquisado:**",
    "**Insights uteis:** 5 bullets",
    "**Angulos de conteudo:** 5 ideias",
    "**Cuidados:** riscos, exageros ou promessas a evitar",
    "**Como usar agora:** proximo passo recomendado",
    `Cliente: ${context.slug}`,
    `Pedido de pesquisa:\n${topic}`
  ].join("\n\n---\n\n");
}

export function buildResearchEnhancedRequest(userRequest: string, researchSummary: string): string {
  return [
    userRequest,
    "",
    "Contexto de pesquisa recente para usar como repertorio, sem copiar literalmente:",
    researchSummary
  ].join("\n");
}

export function buildOneOffCopyPrompt(context: ClientContext, userRequest: string): string {
  return [
    context.promptBase,
    context.agents.copywriter,
    context.profile,
    context.authorMemory,
    "Tarefa do Copywriter: crie um texto avulso para Instagram, sem depender de calendario semanal.",
    "Entenda o pedido natural do usuario e entregue algo pronto para uso.",
    "Responda em Markdown curto com: formato, tema, texto/legenda, CTA e hashtags quando fizer sentido.",
    `Cliente: ${context.slug}`,
    `Pedido do usuario:\n${userRequest}`
  ].join("\n\n---\n\n");
}

export function buildOneOffPostPrompt(context: ClientContext, userRequest: string): string {
  return [
    context.promptBase,
    context.agents.socialMediaManager,
    context.agents.copywriter,
    context.agents.designer,
    context.profile,
    context.authorMemory,
    "Tarefa da Agencia: crie um post avulso completo para Instagram, sem depender de calendario semanal.",
    "Entregue copy e direcao visual de forma objetiva.",
    "Na parte visual, aja como Diretor de Arte: proponha 3 caminhos visuais diferentes, escolha uma recomendacao e gere prompt final com decisao de layout concreta.",
    "A parte visual deve evitar resultado generico de IA. Prefira composicao editorial, grid, respiro, contraste tipografico e elementos abstratos coerentes com a marca.",
    "Evite no prompt visual: icones infantis, clipart, emojis, estrelas de avaliacao, carinhas, graficos fake exagerados, excesso de molduras e aparencia de template pronto.",
    "Inclua obrigatoriamente:",
    "## Post Avulso",
    "**Formato:**",
    "**Tema:**",
    "**Texto da capa:**",
    "**Legenda pronta:**",
    "**CTA:**",
    "**Hashtags:**",
    "**Caminhos visuais:**",
    "**Recomendacao:**",
    "**Direcao visual:**",
    "**Prompt visual:**",
    "No campo **Prompt visual:** proiba criar titulos, subtitulos ou frases extras que nao estejam no texto da capa.",
    `Cliente: ${context.slug}`,
    `Pedido do usuario:\n${userRequest}`
  ].join("\n\n---\n\n");
}

export function buildConversationPrompt(context: ClientContext, state: UserState, message: string): string {
  return [
    context.promptBase,
    context.agents.orchestrator,
    context.agents.socialMediaManager,
    context.profile,
    "Voce e Larisso, um agente de marketing conversacional no Telegram.",
    "Responda como uma conversa natural, curta e util. Nao finja ter executado uma tarefa se ela nao foi executada.",
    "Se a mensagem do usuario for vaga, ajude com o proximo passo mais provavel com base no estado atual.",
    "Se o usuario fizer uma pergunta conceitual, responda em linguagem simples e conecte com o trabalho atual da Cliente Demo quando fizer sentido.",
    "Evite respostas longas. Termine com uma pergunta ou proximo passo claro quando for util.",
    `Estado atual:\n${summarizeState(state)}`,
    `Mensagem do usuario:\n${message}`
  ].join("\n\n---\n\n");
}

export function buildResponseComposerPrompt(
  context: ClientContext,
  state: UserState,
  userMessage: string,
  rawResponse: string
): string {
  return [
    context.promptBase,
    context.agents.orchestrator,
    context.agents.socialMediaManager,
    context.profile,
    "Voce e Larisso, o agente conversacional de uma agencia de marketing no Telegram.",
    "Sua tarefa e reescrever a resposta operacional abaixo para soar mais natural, humana e contextual.",
    "Nao mude fatos, status, aprovacoes, pendencias, valores, dias da semana ou proximas acoes.",
    "Nao invente que executou algo alem do que a resposta operacional diz.",
    "Mantenha curto. Idealmente 2 a 6 linhas.",
    "Se houver uma proxima acao clara, termine com ela.",
    "Nao use Markdown pesado. Pode usar listas curtas se ajudar.",
    `Estado atual:\n${summarizeState(state)}`,
    `Mensagem do usuario:\n${userMessage}`,
    `Resposta operacional:\n${rawResponse}`
  ].join("\n\n---\n\n");
}

function summarizeState(state: UserState): string {
  return [
    `Cliente ativo: ${state.activeClient || "nenhum"}`,
    `Etapa: ${state.state}`,
    `Aguardando aprovacao: ${state.pendingApproval || "nao"}`,
    `Tem pauta: ${state.lastPlan ? "sim" : "nao"}`,
    `Tem pacote de posts: ${state.lastGeneratedContent ? "sim" : "nao"}`,
    `Tem design salvo: ${state.lastDesign ? "sim" : "nao"}`,
    `Tarefa avulsa: ${state.taskMemory ? `${state.taskMemory.kind} (${state.taskMemory.status})` : "nenhuma"}`,
    `Pesquisas no mes: ${state.research ? `${state.research.used}/${state.research.monthlyLimit}` : "nao configurado"}`,
    `Ultima imagem: ${state.lastImage ? `${state.lastImage.dayLabel} (${state.lastImage.status})` : "nenhuma"}`,
    `Modo economia: ${state.preferences?.economyMode ? "sim" : "nao"}`,
    `Evitar imagens: ${state.preferences?.avoidImages ? "sim" : "nao"}`,
    `Modo leigo: ${state.preferences?.beginnerMode ? "sim" : "nao"}`
  ].join("\n");
}






