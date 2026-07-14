export type ActionConfidence = number;

export type MarketingAgentAction =
  | { action: "production_status"; confidence: ActionConfidence }
  | { action: "show_day_package"; confidence: ActionConfidence; dayLabel: ProductionDayLabel }
  | {
      action: "approve_parts";
      confidence: ActionConfidence;
      dayLabel: ProductionDayLabel;
      parts: ProductionApprovalActionPart[];
    }
  | { action: "generate_image"; confidence: ActionConfidence; dayLabel: ProductionDayLabel }
  | { action: "generate_full_posts"; confidence: ActionConfidence }
  | { action: "next_step"; confidence: ActionConfidence }
  | { action: "unknown"; confidence: ActionConfidence };

export type ProductionDayLabel =
  | "Segunda-feira"
  | "Terca-feira"
  | "Quarta-feira"
  | "Quinta-feira"
  | "Sexta-feira";

export type ProductionApprovalActionPart = "copy" | "design" | "image" | "post";

export const productionDayLabels: ProductionDayLabel[] = [
  "Segunda-feira",
  "Terca-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira"
];

export const productionApprovalActionParts: ProductionApprovalActionPart[] = ["copy", "design", "image", "post"];

export const marketingAgentActionExamples = [
  '{"action":"production_status","confidence":0.0-1.0}',
  '{"action":"show_day_package","confidence":0.0-1.0,"dayLabel":"Terca-feira"}',
  '{"action":"approve_parts","confidence":0.0-1.0,"dayLabel":"Terca-feira","parts":["copy","design"]}',
  '{"action":"generate_image","confidence":0.0-1.0,"dayLabel":"Terca-feira"}',
  '{"action":"generate_full_posts","confidence":0.0-1.0}',
  '{"action":"next_step","confidence":0.0-1.0}',
  '{"action":"unknown","confidence":0.0-1.0}'
];
