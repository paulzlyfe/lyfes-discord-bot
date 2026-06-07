import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
} from "discord.js";
import { createServer } from "node:http";
import { runAutomod } from "./automod.js";
import { handleModCommand } from "./commands/moderation.js";
import { handleMusicCommand, handleSearchSelect } from "./commands/music.js";
import { handleConfigCommand } from "./commands/config.js";
import { handleUtilityCommand } from "./commands/utility.js";
import { handleStreamingCommand } from "./commands/streaming.js";
import { getGuildConfig } from "./db.js";
import { stopAndLeave } from "./music.js";
import { startLivePoll } from "./live-poll.js";

const MOD_COMMANDS = new Set([
  "ban", "unban", "kick", "timeout", "untimeout",
  "warn", "warnings", "clearwarnings", "purge",
]);

const MUSIC_COMMANDS = new Set([
  "play", "skip", "stop", "pause", "resume",
  "queue", "loop", "nowplaying", "volume", "search",
]);

const CONFIG_COMMANDS = new Set([
  "setlog", "setmemberlog", "automod", "bannedwords",
]);

const UTILITY_COMMANDS = new Set([
  "ping", "userinfo",
]);

const STREAMING_COMMANDS = new Set([
  "setstreamer", "golive", "offair",
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
  c.user.setActivity("Hard Knock Lyfe");
  startLivePoll(c);
});

client.on(Events.MessageCreate, async (message) => {
  if (!message.guild || message.author.bot) return;
  getGuildConfig(message.guild.id);
  await runAutomod(message);
});

client.on(Events.InteractionCreate, async (interaction) => {
  // Handle search result dropdown picks
  if (interaction.isStringSelectMenu()) {
    if (interaction.customId.startsWith("search_select:")) {
      await handleSearchSelect(interaction);
    }
    return;
  }

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
  } else if (STREAMING_COMMANDS.has(commandName)) {
    await handleStreamingCommand(interaction);
  }
});

client.on(Events.GuildMemberAdd, async (member) => {
  const accountAgeDays = (Date.now() - member.user.createdTimestamp) / 86_400_000;
  const isNewAccount = accountAgeDays < 7;

  // DM the new member
  try {
    await member.send(
      `👋 Welcome to **${member.guild.name}**, ${member.user.username}!\n\n` +
      `Please take a moment to read our rules before chatting: <#1506444500350796019>\n\n` +
      `Hope you enjoy your stay! 🎉`
    );
  } catch {
    // Member has DMs disabled — silently ignore
  }

  // Auto-timeout accounts younger than 1 week
  if (isNewAccount) {
    try {
      await member.timeout(6 * 60 * 60 * 1000, "Account younger than 1 week — pending owner review");
    } catch {
      // Missing permission — skip silently
    }
  }

  // Post to member log channel if configured
  const config = getGuildConfig(member.guild.id);
  if (config.member_log_channel_id) {
    const ch = member.guild.channels.cache.get(config.member_log_channel_id);
    if (ch?.isTextBased()) {
      const { EmbedBuilder } = await import("discord.js");

      const embed = new EmbedBuilder()
        .setColor(isNewAccount ? 0xe67e22 : 0x2ecc71)
        .setTitle(isNewAccount ? "⚠️ New Account Joined — Auto-Muted" : "📥 Member Joined")
        .setThumbnail(member.user.displayAvatarURL())
        .addFields(
          { name: "User", value: `${member.user.tag} (<@${member.id}>)`, inline: true },
          { name: "Account Age", value: `${Math.floor(accountAgeDays)} days`, inline: true },
          { name: "Total Members", value: `${member.guild.memberCount}`, inline: true },
          ...(isNewAccount ? [{ name: "Action", value: "Timed out for 6 hours — please review", inline: false }] : [])
        )
        .setFooter({ text: `ID: ${member.id}` })
        .setTimestamp();

      // Ping the Owner role if it exists, otherwise ping the guild owner
      let ping = `<@${member.guild.ownerId}>`;
      if (isNewAccount) {
        const ownerRole = member.guild.roles.cache.find(
          (r) => r.name.toLowerCase() === "owner" || r.name.toLowerCase() === "owners"
        );
        if (ownerRole) ping = `<@&${ownerRole.id}>`;
      }

      await ch.send({
        content: isNewAccount ? `${ping} — suspicious new account joined and has been auto-muted.` : undefined,
        embeds: [embed],
      }).catch(() => {});
    }
  }
});

client.on(Events.GuildMemberRemove, async (member) => {
  const config = getGuildConfig(member.guild.id);
  if (!config.member_log_channel_id) return;

  const ch = member.guild.channels.cache.get(config.member_log_channel_id);
  if (ch?.isTextBased()) {
    const { EmbedBuilder } = await import("discord.js");
    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle("📤 Member Left")
      .setThumbnail(member.user.displayAvatarURL())
      .addFields(
        { name: "User", value: `${member.user.tag} (<@${member.id}>)`, inline: true },
        { name: "Joined", value: member.joinedTimestamp
          ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`
          : "Unknown", inline: true },
        { name: "Total Members", value: `${member.guild.memberCount}`, inline: true }
      )
      .setFooter({ text: `ID: ${member.id}` })
      .setTimestamp();
    await ch.send({ embeds: [embed] }).catch(() => {});
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

// Health-check server so UptimeRobot can keep the bot awake
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ status: "ok", bot: client.user?.tag ?? "connecting" }));
}).listen(PORT, () => {
  console.log(`🌐 Health-check server listening on port ${PORT}`);
});

client.login(token);
