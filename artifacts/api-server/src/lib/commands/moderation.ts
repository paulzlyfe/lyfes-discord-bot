import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type GuildMember,
  EmbedBuilder,
} from "discord.js";
import { db } from "@workspace/db";
import { guildSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../logger";

export const moderationCommands = [
  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Ban a member from the server")
    .addUserOption((o) =>
      o.setName("user").setDescription("Member to ban").setRequired(true),
    )
    .addStringOption((o) =>
      o.setName("reason").setDescription("Reason for the ban").setRequired(false),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setDMPermission(false),

  new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Kick a member from the server")
    .addUserOption((o) =>
      o.setName("user").setDescription("Member to kick").setRequired(true),
    )
    .addStringOption((o) =>
      o.setName("reason").setDescription("Reason for the kick").setRequired(false),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .setDMPermission(false),

  new SlashCommandBuilder()
    .setName("mute")
    .setDescription("Mute a member for a set duration")
    .addUserOption((o) =>
      o.setName("user").setDescription("Member to mute").setRequired(true),
    )
    .addStringOption((o) =>
      o
        .setName("duration")
        .setDescription("Duration, e.g. 10m, 1h, 2d")
        .setRequired(true),
    )
    .addStringOption((o) =>
      o.setName("reason").setDescription("Reason for the mute").setRequired(false),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false),

  new SlashCommandBuilder()
    .setName("unmute")
    .setDescription("Remove mute from a member")
    .addUserOption((o) =>
      o.setName("user").setDescription("Member to unmute").setRequired(true),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false),
];

function parseDuration(input: string): number | null {
  const match = /^(\d+)(s|m|h|d)$/.exec(input.toLowerCase());
  if (!match) return null;
  const val = parseInt(match[1]!);
  const unit = match[2];
  const multipliers: Record<string, number> = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return val * (multipliers[unit!] ?? 0);
}

async function postLog(
  guildId: string,
  embed: EmbedBuilder,
  client: import("discord.js").Client,
): Promise<void> {
  try {
    const [settings] = await db.select().from(guildSettingsTable).where(eq(guildSettingsTable.guildId, guildId));
    if (!settings?.logChannelId) return;
    const ch = await client.channels.fetch(settings.logChannelId);
    if (ch?.isTextBased()) await (ch as import("discord.js").TextChannel).send({ embeds: [embed] });
  } catch (err) {
    logger.error({ err }, "Failed to post mod log");
  }
}

export async function handleModeration(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const cmd = interaction.commandName;
  const guild = interaction.guild!;
  const moderator = interaction.member as GuildMember;

  if (cmd === "ban") {
    const target = interaction.options.getMember("user") as GuildMember | null;
    const reason = interaction.options.getString("reason") ?? "No reason provided";
    if (!target) { await interaction.reply({ content: "User not found.", ephemeral: true }); return; }
    if (!target.bannable) { await interaction.reply({ content: "I cannot ban this user.", ephemeral: true }); return; }
    await target.ban({ reason });
    await interaction.reply({ content: `✅ **${target.user.tag}** has been banned. Reason: ${reason}`, ephemeral: false });
    await postLog(guild.id, new EmbedBuilder()
      .setColor(0xff0000).setTitle("Member Banned")
      .addFields(
        { name: "User", value: `${target.user.tag} (${target.id})`, inline: true },
        { name: "Moderator", value: moderator.user.tag, inline: true },
        { name: "Reason", value: reason },
      ).setTimestamp(), interaction.client);
  }

  if (cmd === "kick") {
    const target = interaction.options.getMember("user") as GuildMember | null;
    const reason = interaction.options.getString("reason") ?? "No reason provided";
    if (!target) { await interaction.reply({ content: "User not found.", ephemeral: true }); return; }
    if (!target.kickable) { await interaction.reply({ content: "I cannot kick this user.", ephemeral: true }); return; }
    await target.kick(reason);
    await interaction.reply({ content: `✅ **${target.user.tag}** has been kicked. Reason: ${reason}` });
    await postLog(guild.id, new EmbedBuilder()
      .setColor(0xff8800).setTitle("Member Kicked")
      .addFields(
        { name: "User", value: `${target.user.tag} (${target.id})`, inline: true },
        { name: "Moderator", value: moderator.user.tag, inline: true },
        { name: "Reason", value: reason },
      ).setTimestamp(), interaction.client);
  }

  if (cmd === "mute") {
    const target = interaction.options.getMember("user") as GuildMember | null;
    const durationStr = interaction.options.getString("duration", true);
    const reason = interaction.options.getString("reason") ?? "No reason provided";
    if (!target) { await interaction.reply({ content: "User not found.", ephemeral: true }); return; }
    const ms = parseDuration(durationStr);
    if (!ms) { await interaction.reply({ content: "Invalid duration. Use format like `10m`, `1h`, `2d`.", ephemeral: true }); return; }

    const [settings] = await db.select().from(guildSettingsTable).where(eq(guildSettingsTable.guildId, guild.id));
    const mutedRoleId = settings?.mutedRoleId;
    if (!mutedRoleId) {
      await interaction.reply({ content: "No muted role configured. Use `/setmuted` first.", ephemeral: true });
      return;
    }
    await target.roles.add(mutedRoleId, reason);
    await interaction.reply({ content: `✅ **${target.user.tag}** muted for ${durationStr}. Reason: ${reason}` });

    setTimeout(async () => {
      try { await target.roles.remove(mutedRoleId, "Mute expired"); } catch {}
    }, ms);

    await postLog(guild.id, new EmbedBuilder()
      .setColor(0xffff00).setTitle("Member Muted")
      .addFields(
        { name: "User", value: `${target.user.tag} (${target.id})`, inline: true },
        { name: "Moderator", value: moderator.user.tag, inline: true },
        { name: "Duration", value: durationStr, inline: true },
        { name: "Reason", value: reason },
      ).setTimestamp(), interaction.client);
  }

  if (cmd === "unmute") {
    const target = interaction.options.getMember("user") as GuildMember | null;
    if (!target) { await interaction.reply({ content: "User not found.", ephemeral: true }); return; }
    const [settings] = await db.select().from(guildSettingsTable).where(eq(guildSettingsTable.guildId, guild.id));
    const mutedRoleId = settings?.mutedRoleId;
    if (!mutedRoleId) { await interaction.reply({ content: "No muted role configured.", ephemeral: true }); return; }
    await target.roles.remove(mutedRoleId, "Manually unmuted");
    await interaction.reply({ content: `✅ **${target.user.tag}** has been unmuted.` });
  }
}
