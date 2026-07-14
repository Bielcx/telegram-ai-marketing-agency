import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";
import type { AppConfig } from "../config.js";

export async function generateImageFile(config: AppConfig, prompt: string, fileSlug: string): Promise<string> {
  const client = new OpenAI({ apiKey: config.openaiApiKey });

  const result = await client.images.generate({
    model: config.openaiImageModel,
    prompt,
    size: "1024x1024"
  } as never);

  const image = result.data?.[0];
  if (!image) {
    throw new Error("OpenAI image response did not include image data.");
  }

  const outputDir = path.resolve(config.dataDir, "outputs", "images");
  await mkdir(outputDir, { recursive: true });

  const outputPath = path.join(outputDir, `${safeFileName(fileSlug)}-${Date.now()}.png`);

  if ("b64_json" in image && image.b64_json) {
    await writeFile(outputPath, Buffer.from(image.b64_json, "base64"));
    return outputPath;
  }

  if ("url" in image && image.url) {
    const response = await fetch(image.url);
    if (!response.ok) {
      throw new Error(`Failed to download generated image: ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    await writeFile(outputPath, Buffer.from(arrayBuffer));
    return outputPath;
  }

  throw new Error("OpenAI image response did not include b64_json or url.");
}

function safeFileName(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
