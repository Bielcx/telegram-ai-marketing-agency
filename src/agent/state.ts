export type ConversationStateName =
  | "idle"
  | "cliente_selecionado"
  | "coletando_briefing_semana"
  | "pauta_proposta"
  | "posts_gerados"
  | "imagem_pendente_aprovacao"
  | "conteudo_aprovado";

export type UserState = {
  telegramUserId: string;
  activeClient: string | null;
  state: ConversationStateName;
  lastIntent: string | null;
  lastWeeklyGoal: string | null;
  lastPlan: string | null;
  lastCopy: string | null;
  lastDesign: string | null;
  lastReview: string | null;
  lastGeneratedContent: string | null;
  currentWeekId: string | null;
  pendingRevision: {
    kind: "copy" | "design";
    dayLabel: string;
    content: string;
  } | null;
  pendingImage: {
    dayLabel: string;
    prompt: string;
  } | null;
  lastImage: {
    dayLabel: string;
    path: string;
    prompt: string;
    status: "draft" | "approved";
  } | null;
  taskMemory: TaskMemory | null;
  research: ResearchState;
  usage: UsageState;
  pendingApproval: string | null;
  preferences: UserPreferences;
};

export type TaskMemory = {
  id: string;
  kind: "one_off_design" | "one_off_copy" | "one_off_post" | "one_off_image";
  clientSlug: string;
  userRequest: string;
  content: string;
  summary: string;
  visualPrompt: string | null;
  coverText: string | null;
  status: "draft" | "approved" | "ready_for_image" | "image_generated";
  imagePath?: string | null;
  updatedAt: string;
};

export type UserPreferences = {
  economyMode: boolean;
  avoidImages: boolean;
  responseComposer: boolean;
  aiRouter: boolean;
  beginnerMode: boolean;
};

export type ResearchState = {
  monthKey: string;
  used: number;
  monthlyLimit: number;
  lastResearch: {
    clientSlug: string;
    topic: string;
    summary: string;
    createdAt: string;
  } | null;
};

export type UsageState = {
  monthKey: string;
  imageGenerations: number;
  oneOffTasks: number;
};

export function createInitialState(telegramUserId: string): UserState {
  return {
    telegramUserId,
    activeClient: null,
    state: "idle",
    lastIntent: null,
    lastWeeklyGoal: null,
    lastPlan: null,
    lastCopy: null,
    lastDesign: null,
    lastReview: null,
    lastGeneratedContent: null,
    currentWeekId: null,
    pendingRevision: null,
    pendingImage: null,
    lastImage: null,
    taskMemory: null,
    research: createDefaultResearchState(),
    usage: createDefaultUsageState(),
    pendingApproval: null,
    preferences: createDefaultPreferences()
  };
}

export function createDefaultPreferences(): UserPreferences {
  return {
    economyMode: false,
    avoidImages: false,
    responseComposer: true,
    aiRouter: true,
    beginnerMode: true
  };
}

export function createDefaultResearchState(): ResearchState {
  return {
    monthKey: new Date().toISOString().slice(0, 7),
    used: 0,
    monthlyLimit: 10,
    lastResearch: null
  };
}

export function createDefaultUsageState(): UsageState {
  return {
    monthKey: new Date().toISOString().slice(0, 7),
    imageGenerations: 0,
    oneOffTasks: 0
  };
}
