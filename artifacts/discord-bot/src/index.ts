import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
} from "discord.js";
import { createServer } from "node:http";
import { runAutomod } from "./automod.js";
import { handleModCommand } from "./commands/moderation.js";
import { handleMusicCommand, handleSearchSelect } from "./commands/music.js";
import { handleConfigCommand } from "./commands/config.js";
import { handleUtilityCommand } from "./commands/utility.js";
import { handleStreamingCommand } from "./commands/streaming.js";
import { handleGiveawayCommand, resumePendingGiveaways } from "./commands/giveaway.js";
import {
  handleReactionRoleCommand,
  handleReactionAdd,
  handleReactionRemove,
} from "./commands/reactionroles.js";
import { registerCommands } from "./deploy-commands.js";
import { initDb, getGuildConfig, getIgnoredChannels } from "./db.js";
import { stopAndLeave } from "./music.js";
import { startLivePoll } from "./live-poll.js";
import {
  sendMessageDeleteLog, sendMessageEditLog,
  sendVoiceLog, sendMuteLog,
  sendMemberRoleLog,
  sendRoleCreateLog, sendRoleDeleteLog, sendRoleUpdateLog,
  sendChannelCreateLog, sendChannelDeleteLog, sendChannelUpdateLog,
} from "./logger.js";

const MOD_COMMANDS = new Set([
  "ban", "unban", "kick", "timeout", "untimeout",
  "warn", "warnings", "clearwarnings", "purge",
]);

const MUSIC_COMMANDS = new Set([
  "play", "skip", "stop", "pause", "resume",
  "queue", "loop", "nowplaying", "volume", "search",
]);

const CONFIG_COMMANDS = new Set([
  "setlog", "setmemberlog", "automod", "bannedwords", "ignorechannel",
]);

const UTILITY_COMMANDS = new Set([
  "ping", "userinfo",
]);

const STREAMING_COMMANDS = new Set([
  "setstreamer", "golive", "offair", "removestreamer",
]);

const GIVEAWAY_COMMANDS = new Set([
  "giveaway", "giveaway-setup",
]);

const REACTION_ROLE_COMMANDS = new Set([
  "reactionroles", "setreactionrole",
]);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

// Prevent crashes from unhandled Discord API errors (e.g. 40060 "already acknowledged").
// Without this handler Node.js throws the error as an uncaught exception and exits.
client.on("error", (error) => {
  console.error("Discord client error (non-fatal):", error.message ?? error);
});

client.once(Events.ClientReady, async (c) => {
  console.log(`✅ Logged in as ${c.user.tag}`);
  c.user.setActivity("Hard Knock Lyfe");
  startLivePoll(c);
  await resumePendingGiveaways(c);
  await registerCommands(
    process.env.DISCORD_BOT_TOKEN!,
    process.env.DISCORD_CLIENT_ID!
  ).catch((e) => console.error("[commands] Failed to register slash commands:", e));

  // Log voice encryption status so we can verify the right library is loaded on Railway
  try {
    const voice = await import("@discordjs/voice");
    console.log("[voice] Dependency report:\n" + voice.generateDependencyReport());
  } catch (e) {
    console.error("[voice] Could not generate dependency report:", e);
  }
});

client.on(Events.MessageCreate, async (message) => {
  if (!message.guild || message.author.bot) return;
  await getGuildConfig(message.guild.id).catch(() => {});
  await runAutomod(message);
});

client.on(Events.InteractionCreate, async (interaction) => {
  // Handle search result dropdown picks
  if (interaction.isStringSelectMenu()) {
    if (interaction.customId.startsWith("search_select:")) {
      await handleSearchSelect(interaction).catch((e) =>
        console.error("[interaction] select menu error:", e?.message ?? e)
      );
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  try {
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
    } else if (GIVEAWAY_COMMANDS.has(commandName)) {
      await handleGiveawayCommand(interaction, client);
    } else if (REACTION_ROLE_COMMANDS.has(commandName)) {
      await handleReactionRoleCommand(interaction);
    }
  } catch (err: any) {
    console.error(`[interaction] unhandled error in /${commandName}:`, err?.message ?? err);
    try {
      const msg = "❌ An unexpected error occurred. Please try again.";
      if (interaction.replied || interaction.deferred) {
        await interaction.editReply({ content: msg });
      } else {
        await interaction.reply({ content: msg, flags: 64 });
      }
    } catch {
      // interaction already timed out — nothing more we can do
    }
  }
});

client.on(Events.MessageReactionAdd, async (reaction, user) => {
  await handleReactionAdd(reaction, user).catch(() => {});
});

client.on(Events.MessageReactionRemove, async (reaction, user) => {
  await handleReactionRemove(reaction, user).catch(() => {});
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
  const config = await getGuildConfig(member.guild.id);
  if (config.member_log_channel_id) {
    const ignoredChannels = await getIgnoredChannels(member.guild.id);
    const logChannelIgnored = ignoredChannels.find((c) => c.channelId === config.member_log_channel_id);
    if (logChannelIgnored && (logChannelIgnored.scope === "logging" || logChannelIgnored.scope === "both")) return;

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
  const config = await getGuildConfig(member.guild.id);
  if (!config.member_log_channel_id) return;

  const ignoredChannels = await getIgnoredChannels(member.guild.id);
  const logChannelIgnored = ignoredChannels.find((c) => c.channelId === config.member_log_channel_id);
  if (logChannelIgnored && (logChannelIgnored.scope === "logging" || logChannelIgnored.scope === "both")) return;

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

client.on(Events.MessageDelete, async (message) => {
  await sendMessageDeleteLog(client, message).catch(() => {});
});

client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
  await sendMessageEditLog(client, oldMessage, newMessage).catch(() => {});
});

client.on(Events.GuildCreate, async (guild) => {
  console.log(`Joined guild: ${guild.name} (${guild.id})`);
  await getGuildConfig(guild.id).catch(() => {});
});

// Voice state: logging + auto-disconnect
client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  // Log voice joins, leaves, and moves (skip bots)
  await sendVoiceLog(client, oldState, newState).catch(() => {});

  // Auto-disconnect when bot is alone — ignore bot's own state changes
  if (oldState.member?.user.bot || newState.member?.user.bot) return;
  if (!oldState.channelId) return;

  const guild = oldState.guild;
  const me = guild.members.me;
  if (!me?.voice.channel) return;
  if (oldState.channelId !== me.voice.channelId) return;

  const humans = me.voice.channel.members.filter((m) => !m.user.bot);
  if (humans.size === 0) {
    stopAndLeave(guild.id);
  }
});

// Log mutes/timeouts and role changes
client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  await sendMuteLog(client, oldMember, newMember).catch(() => {});
  await sendMemberRoleLog(client, oldMember, newMember).catch(() => {});
});

// Role events
client.on(Events.GuildRoleCreate, async (role) => {
  await sendRoleCreateLog(client, role).catch(() => {});
});
client.on(Events.GuildRoleDelete, async (role) => {
  await sendRoleDeleteLog(client, role).catch(() => {});
});
client.on(Events.GuildRoleUpdate, async (oldRole, newRole) => {
  await sendRoleUpdateLog(client, oldRole, newRole).catch(() => {});
});

// Channel events
client.on(Events.ChannelCreate, async (channel) => {
  if (!channel.isDMBased()) await sendChannelCreateLog(client, channel).catch(() => {});
});
client.on(Events.ChannelDelete, async (channel) => {
  if (!channel.isDMBased()) await sendChannelDeleteLog(client, channel as import("discord.js").GuildChannel).catch(() => {});
});
client.on(Events.ChannelUpdate, async (oldChannel, newChannel) => {
  if (!oldChannel.isDMBased() && !newChannel.isDMBased()) {
    await sendChannelUpdateLog(client, oldChannel as import("discord.js").GuildChannel, newChannel as import("discord.js").GuildChannel).catch(() => {});
  }
});

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
  console.error("❌ DISCORD_BOT_TOKEN is not set.");
  process.exit(1);
}

// Guard: only run the bot in the Fly.io production environment.
// If FLY_APP_NAME is absent and ENABLE_LOCAL_BOT is not set, exit cleanly
// so the Replit dev workflow doesn't spin up a second instance that competes
// with the production bot for gateway events and voice sessions.
if (!process.env.FLY_APP_NAME && !process.env.ENABLE_LOCAL_BOT) {
  console.log("ℹ️  Not running on Fly.io. Set ENABLE_LOCAL_BOT=1 to run locally. Exiting.");
  process.exit(0);
}

// Pre-initialise libsodium-wrappers WASM so it is ready before any voice
// connection is attempted. Without this, the WASM may not be loaded yet when
// @discordjs/voice first tries to encrypt, causing an instant voice failure.
try {
  const sodium = await import("libsodium-wrappers");
  await sodium.ready;
  console.log("✅ libsodium-wrappers ready");
} catch (e) {
  console.warn("⚠️ libsodium-wrappers failed to init, @noble/ciphers will be used instead:", (e as Error).message);
}

// Initialise database tables before connecting to Discord
await initDb();
console.log("✅ Database initialised");

// Health-check server so UptimeRobot / Railway can verify the bot is alive
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ status: "ok", bot: client.user?.tag ?? "connecting" }));
}).listen(PORT, () => {
  console.log(`🌐 Health-check server listening on port ${PORT}`);
});

client.login(token);
