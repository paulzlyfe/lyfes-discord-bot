import {
  ChatInputCommandInteraction,
  GuildMember,
  PermissionFlagsBits,
  SlashCommandBuilder,
  EmbedBuilder,
  TextChannel,
} from "discord.js";
import {
  addWarning,
  clearWarnings,
  getWarnings,
  logAction,
} from "../db.js";
import { sendModLog } from "../logger.js";

// Roles allowed to use /purge (checked by name, case-insensitive).
// Also anyone with ManageMessages permission may use it.
const PURGE_ALLOWED_ROLE_NAMES = new Set(["boss man", "chosen ones"]);

function canPurge(member: GuildMember): boolean {
  if (member.permissions.has(PermissionFlagsBits.ManageMessages)) return true;
  return member.roles.cache.some((r) => PURGE_ALLOWED_ROLE_NAMES.has(r.name.toLowerCase()));
}

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
  .setDescription("Bulk delete messages in this channel")
  .addStringOption((o) =>
    o
      .setName("amount")
      .setDescription("How many messages to delete")
      .setRequired(true)
      .addChoices(
        { name: "50 messages", value: "50" },
        { name: "100 messages", value: "100" },
        { name: "All messages (up to 1000)", value: "all" }
      )
  );

export async function handleModCommand(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild) {
    await interaction.reply({ content: "Must be used in a server.", flags: 64 });
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
      await logAction(guildId, "BAN", target.id, mod.id, reason);
      await sendModLog(interaction.client, guildId, "BAN", target.user.tag, target.id, mod.user.tag, reason);
      await interaction.reply({ content: `✅ Banned **${target.user.tag}**. Reason: ${reason}`, flags: 64 });

    } else if (cmd === "unban") {
      const userId = interaction.options.getString("user_id", true);
      const reason = interaction.options.getString("reason") ?? "No reason provided";
      await interaction.guild.members.unban(userId, reason);
      await logAction(guildId, "UNBAN", userId, mod.id, reason);
      await sendModLog(interaction.client, guildId, "UNBAN", userId, userId, mod.user.tag, reason);
      await interaction.reply({ content: `✅ Unbanned user ID \`${userId}\`.`, flags: 64 });

    } else if (cmd === "kick") {
      const target = interaction.options.getMember("user") as GuildMember;
      const reason = interaction.options.getString("reason") ?? "No reason provided";
      await target.kick(reason);
      await logAction(guildId, "KICK", target.id, mod.id, reason);
      await sendModLog(interaction.client, guildId, "KICK", target.user.tag, target.id, mod.user.tag, reason);
      await interaction.reply({ content: `✅ Kicked **${target.user.tag}**. Reason: ${reason}`, flags: 64 });

    } else if (cmd === "timeout") {
      const target = interaction.options.getMember("user") as GuildMember;
      const duration = interaction.options.getString("duration", true);
      const ms = msFromDuration(duration);
      if (!ms) {
        await interaction.reply({ content: "Invalid duration. Use format: 10s, 5m, 1h, 1d", flags: 64 });
        return;
      }
      const reason = interaction.options.getString("reason") ?? "No reason provided";
      await target.timeout(ms, reason);
      await logAction(guildId, "TIMEOUT", target.id, mod.id, reason, duration);
      await sendModLog(interaction.client, guildId, "TIMEOUT", target.user.tag, target.id, mod.user.tag, reason, `Duration: ${duration}`);
      await interaction.reply({ content: `✅ Timed out **${target.user.tag}** for ${duration}. Reason: ${reason}`, flags: 64 });

    } else if (cmd === "untimeout") {
      const target = interaction.options.getMember("user") as GuildMember;
      await target.timeout(null);
      await logAction(guildId, "UNTIMEOUT", target.id, mod.id);
      await interaction.reply({ content: `✅ Removed timeout from **${target.user.tag}**.`, flags: 64 });

    } else if (cmd === "warn") {
      const target = interaction.options.getMember("user") as GuildMember;
      const reason = interaction.options.getString("reason", true);
      await addWarning(guildId, target.id, mod.id, reason);
      const warnings = await getWarnings(guildId, target.id);
      const count = warnings.length;
      await logAction(guildId, "WARN", target.id, mod.id, reason);
      await sendModLog(interaction.client, guildId, "WARN", target.user.tag, target.id, mod.user.tag, reason, `Total warnings: ${count}`);
      await target.send(`⚠️ You have been warned in **${interaction.guild.name}**.\nReason: ${reason}\nTotal warnings: ${count}`).catch(() => {});
      await interaction.reply({ content: `✅ Warned **${target.user.tag}** (${count} total warnings). Reason: ${reason}`, flags: 64 });

    } else if (cmd === "warnings") {
      const target = interaction.options.getUser("user", true);
      const warns = await getWarnings(guildId, target.id);
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
      await interaction.reply({ embeds: [embed], flags: 64 });

    } else if (cmd === "clearwarnings") {
      const target = interaction.options.getUser("user", true);
      await clearWarnings(guildId, target.id);
      await interaction.reply({ content: `✅ Cleared all warnings for **${target.tag}**.`, flags: 64 });

    } else if (cmd === "purge") {
      // Role / permission check
      if (!canPurge(mod)) {
        await interaction.reply({
          content: "❌ You need the **Boss Man** or **Chosen Ones** role (or Manage Messages permission) to use this command.",
          flags: 64,
        });
        return;
      }

      const amount = interaction.options.getString("amount", true);
      const channel = interaction.channel as TextChannel;
      if (!channel?.isTextBased() || !("bulkDelete" in channel)) {
        await interaction.reply({ content: "❌ This command can only be used in text channels.", flags: 64 });
        return;
      }

      await interaction.deferReply({ flags: 64 });

      let totalDeleted = 0;

      if (amount === "all") {
        // Delete in batches of 100 until the channel is clear (max 10 batches = 1 000 msgs)
        const MAX_BATCHES = 10;
        for (let i = 0; i < MAX_BATCHES; i++) {
          const fetched = await channel.messages.fetch({ limit: 100 });
          if (fetched.size === 0) break;
          const deleted = await channel.bulkDelete(fetched, true).catch(() => null);
          const count = deleted?.size ?? 0;
          totalDeleted += count;
          if (count === 0) break; // no eligible messages left (all >14 days old)
          if (fetched.size < 100) break; // fewer than a full batch — we're done
          await new Promise((r) => setTimeout(r, 1000)); // brief pause between batches
        }
      } else {
        const limit = parseInt(amount, 10);
        const fetched = await channel.messages.fetch({ limit });
        const deleted = await channel.bulkDelete(fetched, true).catch(() => null);
        totalDeleted = deleted?.size ?? 0;
      }

      await logAction(guildId, "PURGE", "all", mod.id, undefined, `Deleted ${totalDeleted} messages (${amount})`);
      await sendModLog(
        interaction.client,
        guildId,
        "CLEAR",
        "channel",
        "all",
        mod.user.tag,
        undefined,
        `Deleted ${totalDeleted} messages (${amount})`
      );
      await interaction.editReply({
        content: `✅ Deleted **${totalDeleted}** messages.${totalDeleted === 0 ? " (Messages older than 14 days cannot be bulk-deleted.)" : ""}`,
      });
    }
  } catch (err: any) {
    const msg = `❌ Error: ${err.message}`;
    if (interaction.replied || interaction.deferred) {
      await interaction.editReply({ content: msg }).catch(() => {});
    } else {
      await interaction.reply({ content: msg, flags: 64 }).catch(() => {});
    }
  }
}
