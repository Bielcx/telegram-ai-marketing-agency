import type { AppConfig } from "../../config.js";
import { loadClientContext } from "../../clients/loader.js";
import { generateText } from "../../openai/text.js";
import {
  buildCopyPrompt,
  buildDesignPrompt,
  buildPlanPrompt,
  buildReviewPrompt,
  buildReviseCopyPrompt,
  buildReviseDesignPrompt
} from "../prompts.js";

export type GeneratedPostPackage = {
  copy: string;
  design: string;
  review: string;
  content: string;
};

export async function generateWeeklyPlan(
  config: AppConfig,
  clientSlug: string,
  weeklyGoal: string
): Promise<string> {
  const context = await loadClientContext(config.agentKnowledgeDir, clientSlug);
  return generateText(config, buildPlanPrompt(context, weeklyGoal));
}

export async function generateFullPostPackage(
  config: AppConfig,
  clientSlug: string,
  weeklyGoal: string,
  approvedPlan: string
): Promise<GeneratedPostPackage> {
  const context = await loadClientContext(config.agentKnowledgeDir, clientSlug);
  const copy = await generateText(config, buildCopyPrompt(context, weeklyGoal, approvedPlan));
  const design = await generateText(config, buildDesignPrompt(context, approvedPlan, copy));
  const review = await generateText(config, buildReviewPrompt(context, approvedPlan, copy, design));

  return {
    copy,
    design,
    review,
    content: buildGeneratedPackageContent(copy, design, review)
  };
}

export async function reviseDayContent(
  config: AppConfig,
  clientSlug: string,
  kind: "copy" | "design",
  dayLabel: string,
  currentSection: string,
  instruction: string
): Promise<string> {
  const context = await loadClientContext(config.agentKnowledgeDir, clientSlug);

  return generateText(
    config,
    kind === "design"
      ? buildReviseDesignPrompt(context, dayLabel, currentSection, instruction)
      : buildReviseCopyPrompt(context, dayLabel, currentSection, instruction)
  );
}

export function buildGeneratedPackageContent(copy: string, design: string, review: string): string {
  return [
    "# Pacote Gerado pela Agencia",
    "## Textos - Copywriter",
    copy,
    "## Direcao Visual - Designer",
    design,
    "## Revisao - Revisor",
    review
  ].join("\n\n");
}
