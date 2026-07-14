export type IntentName =
  | "criar_calendario"
  | "aprovar_pauta"
  | "ajustar_conteudo"
  | "selecionar_cliente"
  | "duvida_geral";

export type IntentResult = {
  intent: IntentName;
  clientSlug: string | null;
  weeklyGoal: string | null;
};

const approvalWords = [
  "sim",
  "pode",
  "aprovado",
  "aprovada",
  "aprovo",
  "aprovao",
  "aprovou",
  "gostei",
  "ficou bom",
  "ficou boa",
  "ta bom",
  "tÃ¡ bom",
  "esta bom",
  "estÃ¡ bom",
  "pode salvar",
  "pode aprovar",
  "manda salvar",
  "salva isso",
  "confirmo",
  "ok",
  "salva",
  "salvar",
  "pode gerar"
];

export function detectIntent(message: string): IntentResult {
  const text = normalize(message);
  const clientSlug = null;

  if (isApprovalMessage(text)) {
    return { intent: "aprovar_pauta", clientSlug, weeklyGoal: null };
  }

  if (text.includes("refaz") || text.includes("ajusta") || text.includes("muda") || text.includes("deixa")) {
    return { intent: "ajustar_conteudo", clientSlug, weeklyGoal: null };
  }

  if (text.includes("cliente") && clientSlug) {
    return { intent: "selecionar_cliente", clientSlug, weeklyGoal: null };
  }

  if (wantsCreateCalendar(text)) {
    return {
      intent: "criar_calendario",
      clientSlug,
      weeklyGoal: extractGoal(message)
    };
  }

  return { intent: "duvida_geral", clientSlug, weeklyGoal: null };
}

function isApprovalMessage(text: string): boolean {
  if (approvalWords.some((word) => text === word)) return true;

  return (
    text.includes("gostei") ||
    text.includes("ficou bom") ||
    text.includes("ficou boa") ||
    text.includes("pode salvar") ||
    text.includes("pode aprovar") ||
    text.includes("manda salvar") ||
    text.includes("salva isso") ||
    text.includes("pode seguir") ||
    text.includes("segue com isso")
  );
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();
}

function extractGoal(message: string): string | null {
  const match = message.match(/(?:foco em|focando em|sobre|tema|objetivo)\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function wantsCreateCalendar(text: string): boolean {
  return (
    text.includes("montar semana") ||
    text.includes("criar semana") ||
    text.includes("gerar semana") ||
    text.includes("planejar semana") ||
    text.includes("montar calendario") ||
    text.includes("criar calendario") ||
    text.includes("gerar calendario") ||
    text.includes("planejar calendario") ||
    text.includes("montar posts") ||
    text.includes("criar posts") ||
    text.includes("gerar posts") ||
    text.includes("planejar posts") ||
    text.includes("nova pauta") ||
    text.includes("criar nova pauta") ||
    text.includes("gerar nova pauta") ||
    text.includes("semana da cliente-demo") ||
    text.includes("calendario da cliente-demo")
  );
}

