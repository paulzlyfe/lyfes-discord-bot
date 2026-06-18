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
  ignorechannelCommand,
  setlogCommand,
  setmemberlogCommand,
} from "./commands/config.js";
import { pingCommand, userinfoCommand } from "./commands/utility.js";
import { setstreamerCommand, goliveCommand, offairCommand, removestreamerCommand } from "./commands/streaming.js";
import { giveawayCommand, giveawaySetupCommand } from "./commands/giveaway.js";
import { reactionRolesCommand, setReactionRoleCommand } from "./commands/reactionroles.js";

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
  ignorechannelCommand,
  pingCommand,
  userinfoCommand,
  setstreamerCommand,
  goliveCommand,
  offairCommand,
  removestreamerCommand,
  giveawayCommand,
  giveawaySetupCommand,
  reactionRolesCommand,
  setReactionRoleCommand,
].map((c) => c.toJSON());

export async function registerCommands(token: string, clientId: string): Promise<void> {
  const rest = new REST().setToken(token);
  console.log("[commands] Registering slash commands with Discord...");
  await rest.put(Routes.applicationCommands(clientId), { body: commands });
  console.log("[commands] ✅ Slash commands registered globally.");
}

// Allow running as a standalone script: node --import tsx/esm src/deploy-commands.ts
const token = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
if (token && clientId) {
  await registerCommands(token, clientId);
}
