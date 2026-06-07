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
  searchCommand,
  skipCommand,
  stopCommand,
  volumeCommand,
} from "./commands/music.js";
import {
  automodCommand,
  bannedwordsCommand,
  setlogCommand,
  setmemberlogCommand,
} from "./commands/config.js";
import { pingCommand, userinfoCommand } from "./commands/utility.js";
import { setstreamerCommand, goliveCommand, offairCommand } from "./commands/streaming.js";

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
  volumeCommand,
  searchCommand,
  setlogCommand,
  setmemberlogCommand,
  automodCommand,
  bannedwordsCommand,
  pingCommand,
  userinfoCommand,
  setstreamerCommand,
  goliveCommand,
  offairCommand,
].map((c) => c.toJSON());

const rest = new REST().setToken(token);

console.log("Registering slash commands...");
await rest.put(Routes.applicationCommands(clientId), { body: commands });
console.log("✅ Slash commands registered globally.");
