import {
  ChatInputCommandInteraction,
  GuildMember,
  PermissionFlagsBits,
  SlashCommandBuilder,
  EmbedBuilder,
} from "discord.js";
import {
  addWarning,
  clearWarnings,
  getWarnings,
  logAction,
} from "../db.js";
import { sendModLog } from "../logger.js";

const msFromDuration = (d: string): number => {
  const match = d.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return 0;
  const n = parseInt(match[1]);
  const map: Record<string, number> = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return n * map[match[2]];
};

export const banCommand = new SlashCommandBuilder()
  .setName("ban")
  .setDescription("Ban a member")
  .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
  .addUserOption((o) => o.setName("user").setDescription("User to ban").setRequired(true))
  .addStringOption((o) => o.setName("reason").setDescription("Reason"))
  .addIntegerOption((o) =>
    o.setName("delete_days").setDescription("Days of messages to delete (0-7)").setMinValue(0).setMaxValue(7)
  );

export const unbanCommand = new SlashCommandBuilder()
  .setName("unban")
  .setDescription("Unban a user by ID")
  .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
  .addStringOption((o) => o.setName("user_id").setDescription("User ID to unban").setRequired(true))
  .addStringOption((o) => o.setName("reason").setDescription("Reason"));

export const kickCommand = new SlashCommandBuilder()
  .setName("kick")
  .setDescription("Kick a member")
  .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
  .addUserOption((o) => o.setName("user").setDescription("User to kick").setRequired(true))
  .addStringOption((o) => o.setName("reason").setDescription("Reason"));

export const timeoutCommand = new SlashCommandBuilder()
  .setName("timeout")
  .setDescription("Timeout a member")
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .addUserOption((o) => o.setName("user").setDescription("User to timeout").setRequired(true))
  .addStringOption((o) =>
    o.setName("duration").setDescription("Duration e.g. 10m, 1h, 1d").setRequired(true)
  )
  .addStringOption((o) => o.setName("reason").setDescription("Reason"));

export const untimeoutCommand = new SlashCommandBuilder()
  .setName("untimeout")
  .setDescription("Remove timeout from a member")
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .addUserOption((o) => o.setName("user").setDescription("User").setRequired(true));

export const warnCommand = new SlashCommandBuilder()
  .setName("warn")
  .setDescription("Warn a member")
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .addUserOption((o) => o.setName("user").setDescription("User to warn").setRequired(true))
  .addStringOption((o) => o.setName("reason").setDescription("Reason").setRequired(true));

export const warningsCommand = new SlashCommandBuilder()
  .setName("warnings")
  .setDescription("View warnings for a user")
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .addUserOption((o) => o.setName("user").setDescription("User").setRequired(true));

export const clearwarningsCommand = new SlashCommandBuilder()
  .setName("clearwarnings")
  .setDescription("Clear all warnings for a user")
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .addUserOption((o) => o.setName("user").setDescription("User").setRequired(true));

export const purgeCommand = new SlashCommandBuilder()
  .setName("purge")
  .setDescription("Bulk delete messages")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
  .addIntegerOption((o) =>
    o.setName("count").setDescription("Number of messages to delete (1-100)").setRequired(true).setMinValue(1).setMaxValue(100)
  )
  .addUserOption((o) => o.setName("user").setDescription("Only delete messages from this user"));

export async function handleModCommand(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild) {
    await interaction.reply({ content: "Must be used in a server.", ephemeral: true });
    return;
  }

  const mod = interaction.member as GuildMember;
  const guildId = interaction.guild.id;
  const cmd = interaction.commandName;

  try {
    if (cmd === "ban") {
      const target = interaction.options.getMember("user") as GuildMember;
      const reason = interaction.options.getString("reason") ?? "No reason provided";
      const deleteDays = interaction.options.getInteger("delete_days") ?? 0;
      await target.ban({ reason, deleteMessageSeconds: deleteDays * 86400 });
      logAction(guildId, "BAN", target.id, mod.id, reason);
      await sendModLog(interaction.client, guildId, "BAN", target.user.tag, target.id, mod.user.tag, reason);
      await interaction.reply({ content: `✅ Banned **${target.user.tag}**. Reason: ${reason}`, ephemeral: true });

    } else if (cmd === "unban") {
      const userId = interaction.options.getString("user_id", true);
      const reason = interaction.options.getString("reason") ?? "No reason provided";
      await interaction.guild.members.unban(userId, reason);
      logAction(guildId, "UNBAN", userId, mod.id, reason);
      await sendModLog(interaction.client, guildId, "UNBAN", userId, userId, mod.user.tag, reason);
      await interaction.reply({ content: `✅ Unbanned user ID \`${userId}\`.`, ephemeral: true });

    } else if (cmd === "kick") {
      const target = interaction.options.getMember("user") as GuildMember;
      const reason = interaction.options.getString("reason") ?? "No reason provided";
      await target.kick(reason);
      logAction(guildId, "KICK", target.id, mod.id, reason);
      await sendModLog(interaction.client, guildId, "KICK", target.user.tag, target.id, mod.user.tag, reason);
      await interaction.reply({ content: `✅ Kicked **${target.user.tag}**. Reason: ${reason}`, ephemeral: true });

    } else if (cmd === "timeout") {
      const target = interaction.options.getMember("user") as GuildMember;
      const duration = interaction.options.getString("duration", true);
      const ms = msFromDuration(duration);
      if (!ms) {
        await interaction.reply({ content: "Invalid duration. Use format: 10s, 5m, 1h, 1d", ephemeral: true });
        return;
      }
      const reason = interaction.options.getString("reason") ?? "No reason provided";
      await target.timeout(ms, reason);
      logAction(guildId, "TIMEOUT", target.id, mod.id, reason, duration);
      await sendModLog(interaction.client, guildId, "TIMEOUT", target.user.tag, target.id, mod.user.tag, reason, `Duration: ${duration}`);
      await interaction.reply({ content: `✅ Timed out **${target.user.tag}** for ${duration}. Reason: ${reason}`, ephemeral: true });

    } else if (cmd === "untimeout") {
      const target = interaction.options.getMember("user") as GuildMember;
      await target.timeout(null);
      logAction(guildId, "UNTIMEOUT", target.id, mod.id);
      await interaction.reply({ content: `✅ Removed timeout from **${target.user.tag}**.`, ephemeral: true });

    } else if (cmd === "warn") {
      const target = interaction.options.getMember("user") as GuildMember;
      const reason = interaction.options.getString("reason", true);
      addWarning(guildId, target.id, mod.id, reason);
      const count = getWarnings(guildId, target.id).length;
      logAction(guildId, "WARN", target.id, mod.id, reason);
      await sendModLog(interaction.client, guildId, "WARN", target.user.tag, target.id, mod.user.tag, reason, `Total warnings: ${count}`);
      await target.send(`⚠️ You have been warned in **${interaction.guild.name}**.\nReason: ${reason}\nTotal warnings: ${count}`).catch(() => {});
      await interaction.reply({ content: `✅ Warned **${target.user.tag}** (${count} total warnings). Reason: ${reason}`, ephemeral: true });

    } else if (cmd === "warnings") {
      const target = interaction.options.getUser("user", true);
      const warns = getWarnings(guildId, target.id);
      const embed = new EmbedBuilder()
        .setTitle(`Warnings for ${target.tag}`)
        .setColor(0xf1c40f)
        .setDescription(
          warns.length === 0
            ? "No warnings."
            : warns
                .map((w, i) =>
                  `**${i + 1}.** ${w.reason} — <@${w.moderator_id}> <t:${w.created_at}:R>`
                )
                .join("\n")
        );
      await interaction.reply({ embeds: [embed], ephemeral: true });

    } else if (cmd === "clearwarnings") {
      const target = interaction.options.getUser("user", true);
      clearWarnings(guildId, target.id);
      await interaction.reply({ content: `✅ Cleared all warnings for **${target.tag}**.`, ephemeral: true });

    } else if (cmd === "purge") {
      const count = interaction.options.getInteger("count", true);
      const filterUser = interaction.options.getUser("user");
      const channel = interaction.channel;
      if (!channel?.isTextBased()) return;
      await interaction.deferReply({ ephemeral: true });
      let messages = await channel.messages.fetch({ limit: count });
      if (filterUser) messages = messages.filter((m) => m.author.id === filterUser.id);
      if (!("bulkDelete" in channel)) return;
      const deleted = await (channel as any).bulkDelete(messages, true);
      logAction(guildId, "CLEAR", filterUser?.id ?? "all", mod.id, undefined, `Deleted ${deleted.size} messages`);
      await sendModLog(interaction.client, guildId, "CLEAR", filterUser?.tag ?? "channel", filterUser?.id ?? "all", mod.user.tag, undefined, `Deleted ${deleted.size} messages`);
      await interaction.editReply({ content: `✅ Deleted ${deleted.size} messages.` });
    }
  } catch (err: any) {
    const msg = `❌ Error: ${err.message}`;
    if (interaction.replied || interaction.deferred) {
      await interaction.editReply({ content: msg }).catch(() => {});
    } else {
      await interaction.reply({ content: msg, ephemeral: true }).catch(() => {});
    }
  }
}
