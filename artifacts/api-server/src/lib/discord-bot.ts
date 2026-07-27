import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  PartialMessageReaction,
  type ChatInputCommandInteraction,
  type MessageReaction,
  type User,
} from "discord.js";
import { db } from "@workspace/db";
import { guildConfigsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

// Commands
import { moderationCommands, handleModeration } from "./commands/moderation";
import { loggingCommands, handleLogging } from "./commands/logging";
import { adminCommands, handleAdmin } from "./commands/admin";
import { automodCommands, handleAutomodCmds } from "./commands/automod-cmds";
import { streamingCommands, handleStreaming } from "./commands/streaming";
import { musicCommands, handleMusic } from "./commands/music";
import { reactionCommands, handleReactions, handleReactionRoleEvent } from "./commands/reactions";
import { giveawayCommands, handleGiveaway, handleGiveawayReaction } from "./commands/giveaway";

// Services
import { handleAutomod } from "./services/automod-service";
import { startStreamingMonitor } from "./services/streaming-monitor";

// ── Slash command for /setchannel (GitHub updates) ──────────────────────────
import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  type TextChannel,
} from "discord.js";

const setChannelCommand = new SlashCommandBuilder()
  .setName("setchannel")
  .setDescription("Set the channel where GitHub push updates are posted")
  .addChannelOption((option) =>
    option
      .setName("channel")
      .setDescription("The channel to receive GitHub updates")
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(true),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false);

// ── All commands ─────────────────────────────────────────────────────────────
const ALL_COMMANDS = [
  setChannelCommand,
  ...moderationCommands,
  ...loggingCommands,
  ...adminCommands,
  ...automodCommands,
  ...streamingCommands,
  ...musicCommands,
  ...reactionCommands,
  ...giveawayCommands,
];

const DISCORD_BOT_TOKEN = process.env["DISCORD_BOT_TOKEN"];
const DISCORD_CLIENT_ID = process.env["DISCORD_CLIENT_ID"];
const GUILD_ID = "1506422478300516422";

if (!DISCORD_BOT_TOKEN) throw new Error("DISCORD_BOT_TOKEN is required");
if (!DISCORD_CLIENT_ID) throw new Error("DISCORD_CLIENT_ID is required");

export const discordClient = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: ["MESSAGE", "CHANNEL", "REACTION"] as never[],
});

async function registerCommands(): Promise<void> {
  const rest = new REST().setToken(DISCORD_BOT_TOKEN!);
  try {
    await rest.put(
      Routes.applicationGuildCommands(DISCORD_CLIENT_ID!, GUILD_ID),
      { body: ALL_COMMANDS.map((c) => c.toJSON()) },
    );
    logger.info({ guildId: GUILD_ID, count: ALL_COMMANDS.length }, "Registered guild commands");
  } catch (err) {
    logger.error({ err }, "Failed to register commands");
  }
}

async function handleSetChannel(interaction: ChatInputCommandInteraction): Promise<void> {
  const channel = interaction.options.getChannel("channel", true);
  const guildId = interaction.guildId!;
  await db
    .insert(guildConfigsTable)
    .values({ guildId, channelId: channel.id })
    .onConflictDoUpdate({ target: guildConfigsTable.guildId, set: { channelId: channel.id } });
  await interaction.reply({
    content: `✅ GitHub push updates will now be posted to <#${channel.id}>.`,
    ephemeral: true,
  });
  logger.info({ guildId, channelId: channel.id }, "Guild GitHub channel configured");
}

const COMMAND_GROUPS = new Set([
  ...moderationCommands.map((c) => c.name),
  ...loggingCommands.map((c) => c.name),
  ...adminCommands.map((c) => c.name),
  ...automodCommands.map((c) => c.name),
  ...streamingCommands.map((c) => c.name),
  ...musicCommands.map((c) => c.name),
  ...reactionCommands.map((c) => c.name),
  ...giveawayCommands.map((c) => c.name),
]);

discordClient.once("clientReady", async (client) => {
  logger.info({ tag: client.user.tag }, "Discord bot ready");
  await registerCommands();
  startStreamingMonitor(client);
});

discordClient.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const cmd = interaction.commandName;

  try {
    if (cmd === "setchannel") { await handleSetChannel(interaction); return; }
    if (["ban", "kick", "mute", "unmute"].includes(cmd)) { await handleModeration(interaction); return; }
    if (["setlog", "setmuted"].includes(cmd)) { await handleLogging(interaction); return; }
    if (["setadmin", "removeadmin"].includes(cmd)) { await handleAdmin(interaction); return; }
    if (["addword", "removeword", "ignore"].includes(cmd)) { await handleAutomodCmds(interaction); return; }
    if (["setstreamer", "removestreamer", "golive", "offair", "setlive", "setalerts"].includes(cmd)) { await handleStreaming(interaction); return; }
    if (["play", "search", "queue", "stop", "skip"].includes(cmd)) { await handleMusic(interaction); return; }
    if (cmd === "reactionroles") { await handleReactions(interaction); return; }
    if (["giveaway", "setgiveaway"].includes(cmd)) { await handleGiveaway(interaction); return; }
  } catch (err) {
    logger.error({ err, cmd }, "Error handling command");
    const msg = { content: "An error occurred. Please try again.", ephemeral: true };
    try {
      if (interaction.replied || interaction.deferred) await interaction.followUp(msg);
      else await interaction.reply(msg);
    } catch {}
  }
});

discordClient.on("messageCreate", async (message) => {
  await handleAutomod(message).catch((err) => logger.error({ err }, "automod error"));
});

discordClient.on("messageReactionAdd", async (reaction, user) => {
  try {
    const r = reaction.partial ? await reaction.fetch() : reaction as MessageReaction;
    const u = user.partial ? await user.fetch() : user as User;
    await handleReactionRoleEvent(r, u, true);
    await handleGiveawayReaction(r, u, true);
  } catch (err) { logger.error({ err }, "reactionAdd error"); }
});

discordClient.on("messageReactionRemove", async (reaction, user) => {
  try {
    const r = reaction.partial ? await (reaction as PartialMessageReaction).fetch() : reaction as MessageReaction;
    const u = user.partial ? await user.fetch() : user as User;
    await handleReactionRoleEvent(r, u, false);
    await handleGiveawayReaction(r, u, false);
  } catch (err) { logger.error({ err }, "reactionRemove error"); }
});

/**
 * Post a GitHub push embed to all configured channels.
 */
export async function postPushToChannels(embed: object): Promise<void> {
  const configs = await db.select().from(guildConfigsTable);
  for (const config of configs) {
    try {
      const channel = await discordClient.channels.fetch(config.channelId);
      if (channel?.isTextBased()) {
        await (channel as TextChannel).send({ embeds: [embed as never] });
      }
    } catch (err) {
      logger.error({ err, guildId: config.guildId }, "Failed to post GitHub update");
    }
  }
}

export async function startDiscordBot(): Promise<void> {
  await discordClient.login(DISCORD_BOT_TOKEN);
}
