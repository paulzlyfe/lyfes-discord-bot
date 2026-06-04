import { REST, Routes } from "discord.js";
import {
  banCommand,
  clearwarningsCommand,
  kickCommand,
  purgeCommand,
  timeoutCommand,
  untimeoutCommand,
  unbanCommand,
  warnCommand,
  warningsCommand,
} from "./commands/moderation.js";
import {
  loopCommand,
  nowPlayingCommand,
  pauseCommand,
  playCommand,
  queueCommand,
  resumeCommand,
  skipCommand,
  stopCommand,
} from "./commands/music.js";
import {
  automodCommand,
  bannedwordsCommand,
  setlogCommand,
} from "./commands/config.js";

const token = process.env.DISCORD_BOT_TOKEN!;
const clientId = process.env.DISCORD_CLIENT_ID!;

const commands = [
  banCommand,
  unbanCommand,
  kickCommand,
  timeoutCommand,
  untimeoutCommand,
  warnCommand,
  warningsCommand,
  clearwarningsCommand,
  purgeCommand,
  playCommand,
  skipCommand,
  stopCommand,
  pauseCommand,
  resumeCommand,
  queueCommand,
  loopCommand,
  nowPlayingCommand,
  setlogCommand,
  automodCommand,
  bannedwordsCommand,
].map((c) => c.toJSON());

const rest = new REST().setToken(token);

console.log("Registering slash commands...");
await rest.put(Routes.applicationCommands(clientId), { body: commands });
console.log("✅ Slash commands registered globally.");
