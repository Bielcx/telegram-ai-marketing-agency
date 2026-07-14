import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export type ClientContext = {
  slug: string;
  promptBase: string;
  profile: string;
  authorMemory: string;
  agents: {
    orchestrator: string;
    strategist: string;
    copywriter: string;
    designer: string;
    reviewer: string;
    socialMediaManager: string;
  };
};

export async function listClientSlugs(knowledgeDir: string): Promise<string[]> {
  const clientsDir = path.resolve(knowledgeDir, "clientes");
  const entries = await readdir(clientsDir, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

export async function loadClientContext(knowledgeDir: string, clientSlug: string): Promise<ClientContext> {
  const promptBasePath = path.resolve(knowledgeDir, "prompt-base.md");
  const agentsDir = path.resolve(knowledgeDir, "agentes");
  const clientDir = path.resolve(knowledgeDir, "clientes", clientSlug);

  const [promptBase, profile, authorMemory, orchestrator, strategist, copywriter, designer, reviewer, socialMediaManager] =
  await Promise.all([
    readFile(promptBasePath, "utf8"),
    readFile(path.join(clientDir, "perfil.md"), "utf8"),
    readFile(path.join(clientDir, "memoria-autoral.md"), "utf8"),
    readFile(path.join(agentsDir, "orquestrador.md"), "utf8"),
    readFile(path.join(agentsDir, "estrategista-calendario.md"), "utf8"),
    readFile(path.join(agentsDir, "copywriter.md"), "utf8"),
    readFile(path.join(agentsDir, "designer.md"), "utf8"),
    readFile(path.join(agentsDir, "revisor.md"), "utf8"),
    readFile(path.join(agentsDir, "social-media-manager.md"), "utf8")
  ]);

  return {
    slug: clientSlug,
    promptBase,
    profile,
    authorMemory,
    agents: {
      orchestrator,
      strategist,
      copywriter,
      designer,
      reviewer,
      socialMediaManager
    }
  };
}
