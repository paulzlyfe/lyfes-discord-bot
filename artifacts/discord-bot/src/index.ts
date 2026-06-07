import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
} from "discord.js";
import { runAutomod } from "./automod.js";
import { handleModCommand } from "./commands/moderation.js";
import { handleMusicCommand } from "./commands/music.js";
import { handleConfigCommand } from "./commands/config.js";
import { handleUtilityCommand } from "./commands/utility.js";
import { getGuildConfig } from "./db.js";
import { stopAndLeave } from "./music.js";

const MOD_COMMANDS = new Set([
  "ban", "unban", "kick", "timeout", "untimeout",
  "warn", "warnings", "clearwarnings", "purge",
]);

const MUSIC_COMMANDS = new Set([
  "play", "skip", "stop", "pause", "resume",
  "queue", "loop", "nowplaying", "volume",
]);

const CONFIG_COMMANDS = new Set([
  "setlog", "automod", "bannedwords",
]);

const UTILITY_COMMANDS = new Set([
  "ping",
]);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildModeration,
  ],
  partials: [Partials.Message, Partials.Channel],
});

client.once(Events.ClientReady, (c) => {
  console.log(`✅ Logged in as ${c.user.tag}`);
  c.user.setActivity("🚛 Transport Tycoon | /help");
});

client.on(Events.MessageCreate, async (message) => {
  if (!message.guild || message.author.bot) return;
  getGuildConfig(message.guild.id);
  await runAutomod(message);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  if (MOD_COMMANDS.has(commandName)) {
    await handleModCommand(interaction);
  } else if (MUSIC_COMMANDS.has(commandName)) {
    await handleMusicCommand(interaction);
  } else if (CONFIG_COMMANDS.has(commandName)) {
    await handleConfigCommand(interaction);
  } else if (UTILITY_COMMANDS.has(commandName)) {
    await handleUtilityCommand(interaction);
  }
});

client.on(Events.GuildCreate, (guild) => {
  console.log(`Joined guild: ${guild.name} (${guild.id})`);
  getGuildConfig(guild.id);
});

// Auto-disconnect when bot is alone in voice channel
client.on(Events.VoiceStateUpdate, (oldState) => {
  const guild = oldState.guild;
  const me = guild.members.me;
  if (!me?.voice.channel) return;
  const members = me.voice.channel.members.filter((m) => !m.user.bot);
  if (members.size === 0) {
    stopAndLeave(guild.id);
  }
});

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
  console.error("❌ DISCORD_BOT_TOKEN is not set.");
  process.exit(1);
}

client.login(token);
