import "dotenv/config";
import { createBot } from "./bot.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const bot = createBot(config);

bot.start({
  onStart: (info) => {
    console.log(`Agente de Marketing ativo como @${info.username}`);
  }
});
