import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
  type ChatInputCommandInteraction,
  type TextChannel,
} from "discord.js";
import { db } from "@workspace/db";
import { guildSettingsTable, streamerProfilesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "../logger";

export const streamingCommands = [
  new SlashCommandBuilder()
    .setName("setstreamer")
    .setDescription("Save your Twitch or YouTube channel link to your profile")
    .addStringOption((o) =>
      o
        .setName("url")
        .setDescription("Your full Twitch or YouTube channel URL")
        .setRequired(true),
    )
    .setDMPermission(false),

  new SlashCommandBuilder()
    .setName("removestreamer")
    .setDescription("Unlink your streaming channel — stops auto-alerts")
    .setDMPermission(false),

  new SlashCommandBuilder()
    .setName("golive")
    .setDescription("Manually announce you are going live right now")
    .addStringOption((o) =>
      o.setName("title").setDescription("Stream title").setRequired(false),
    )
    .setDMPermission(false),

  new SlashCommandBuilder()
    .setName("offair")
    .setDescription("Announce your livestream has ended")
    .setDMPermission(false),

  new SlashCommandBuilder()
    .setName("setlive")
    .setDescription("Set the role given to live streamers")
    .addRoleOption((o) =>
      o.setName("role").setDescription("Streamer role").setRequired(true),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),

  new SlashCommandBuilder()
    .setName("setalerts")
    .setDescription("Set the channel where live alerts are posted")
    .addChannelOption((o) =>
      o
        .setName("channel")
        .setDescription("Alerts channel")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),
];

function detectPlatform(url: string): "twitch" | "youtube" | null {
  if (/twitch\.tv/i.test(url)) return "twitch";
  if (/youtube\.com|youtu\.be/i.test(url)) return "youtube";
  return null;
}

function extractIdentifier(url: string, platform: "twitch" | "youtube"): string {
  if (platform === "twitch") {
    const m = /twitch\.tv\/([^/?#]+)/i.exec(url);
    return m?.[1] ?? url;
  }
  const m = /(?:channel\/|@)([^/?#]+)/i.exec(url);
  return m?.[1] ?? url;
}

export async function handleStreaming(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const guild = interaction.guild!;
  const userId = interaction.user.id;

  if (interaction.commandName === "setstreamer") {
    const url = interaction.options.getString("url", true);
    const platform = detectPlatform(url);
    if (!platform) {
      await interaction.reply({ content: "Please provide a valid Twitch or YouTube URL.", ephemeral: true });
      return;
    }
    const identifier = extractIdentifier(url, platform);
    await db
      .insert(streamerProfilesTable)
      .values({ userId, guildId: guild.id, platform, channelUrl: url, channelIdentifier: identifier })
      .onConflictDoUpdate({
        target: [streamerProfilesTable.userId, streamerProfilesTable.guildId],
        set: { platform, channelUrl: url, channelIdentifier: identifier },
      });
    await interaction.reply({
      content: `✅ Your ${platform === "twitch" ? "Twitch" : "YouTube"} channel has been saved. The bot will alert when you go live.`,
      ephemeral: true,
    });
  }

  if (interaction.commandName === "removestreamer") {
    await db
      .delete(streamerProfilesTable)
      .where(
        and(
          eq(streamerProfilesTable.userId, userId),
          eq(streamerProfilesTable.guildId, guild.id),
        ),
      );
    await interaction.reply({ content: "✅ Your streaming profile has been removed.", ephemeral: true });
  }

  if (interaction.commandName === "golive") {
    const title = interaction.options.getString("title") ?? "Come watch!";
    const [profile] = await db
      .select()
      .from(streamerProfilesTable)
      .where(and(eq(streamerProfilesTable.userId, userId), eq(streamerProfilesTable.guildId, guild.id)));
    const [settings] = await db.select().from(guildSettingsTable).where(eq(guildSettingsTable.guildId, guild.id));

    const alertChannelId = settings?.liveAlertChannelId;
    if (!alertChannelId) {
      await interaction.reply({ content: "No alerts channel set. Ask an admin to use `/setalerts`.", ephemeral: true });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0x9146ff)
      .setTitle(`${interaction.user.displayName} is LIVE!`)
      .setDescription(`**${title}**`)
      .setThumbnail(interaction.user.displayAvatarURL())
      .setTimestamp();

    if (profile) embed.addFields({ name: "Watch here", value: profile.channelUrl });

    try {
      const ch = await interaction.client.channels.fetch(alertChannelId) as TextChannel;
      const streamerRoleId = settings?.streamerRoleId;
      const mention = streamerRoleId ? `<@&${streamerRoleId}> ` : "";
      await ch.send({ content: `${mention}🔴 **${interaction.user.displayName}** just went live!`, embeds: [embed] });
    } catch (err) {
      logger.error({ err }, "Failed to post go-live alert");
    }

    await interaction.reply({ content: "✅ Live alert posted!", ephemeral: true });
  }

  if (interaction.commandName === "offair") {
    const [settings] = await db.select().from(guildSettingsTable).where(eq(guildSettingsTable.guildId, guild.id));
    const alertChannelId = settings?.liveAlertChannelId;
    if (!alertChannelId) {
      await interaction.reply({ content: "No alerts channel configured.", ephemeral: true });
      return;
    }
    try {
      const ch = await interaction.client.channels.fetch(alertChannelId) as TextChannel;
      await ch.send({ content: `📴 **${interaction.user.displayName}** has ended their stream. Thanks for watching!` });
    } catch (err) {
      logger.error({ err }, "Failed to post off-air alert");
    }
    await interaction.reply({ content: "✅ Off-air announcement posted.", ephemeral: true });
  }

  if (interaction.commandName === "setlive") {
    const role = interaction.options.getRole("role", true);
    await db
      .insert(guildSettingsTable)
      .values({ guildId: guild.id, streamerRoleId: role.id })
      .onConflictDoUpdate({ target: guildSettingsTable.guildId, set: { streamerRoleId: role.id } });
    await interaction.reply({ content: `✅ Live streamer role set to **${role.name}**.`, ephemeral: true });
  }

  if (interaction.commandName === "setalerts") {
    const channel = interaction.options.getChannel("channel", true);
    await db
      .insert(guildSettingsTable)
      .values({ guildId: guild.id, liveAlertChannelId: channel.id })
      .onConflictDoUpdate({ target: guildSettingsTable.guildId, set: { liveAlertChannelId: channel.id } });
    await interaction.reply({ content: `✅ Live alerts will be posted in <#${channel.id}>.`, ephemeral: true });
  }
}
