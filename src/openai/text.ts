import OpenAI from "openai";
import type { AppConfig } from "../config.js";

export async function generateText(config: AppConfig, prompt: string): Promise<string> {
  const client = new OpenAI({ apiKey: config.openaiApiKey });

  const response = await client.responses.create({
    model: config.openaiTextModel,
    input: prompt
  });

  return response.output_text;
}

export async function generateTextWithWebSearch(config: AppConfig, prompt: string): Promise<string> {
  const client = new OpenAI({ apiKey: config.openaiApiKey });

  const response = await client.responses.create({
    model: config.openaiResearchModel,
    tools: [
      {
        type: "web_search",
        search_context_size: "low"
      }
    ],
    input: prompt
  } as never);

  return response.output_text;
}
