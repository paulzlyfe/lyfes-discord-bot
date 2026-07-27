import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  type ChatInputCommandInteraction,
} from "discord.js";
import { db } from "@workspace/db";
import { guildSettingsTable } from "@workspace/db";

export const loggingCommands = [
  new SlashCommandBuilder()
    .setName("setlog")
    .setDescription("Set the channel where moderation actions are logged")
    .addChannelOption((o) =>
      o
        .setName("channel")
        .setDescription("Channel for mod logs")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),

  new SlashCommandBuilder()
    .setName("setmuted")
    .setDescription("Set the muted role used by /mute")
    .addRoleOption((o) =>
      o.setName("role").setDescription("The muted role").setRequired(true),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),
];

export async function handleLogging(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const guild = interaction.guild!;

  if (interaction.commandName === "setlog") {
    const channel = interaction.options.getChannel("channel", true);
    await db
      .insert(guildSettingsTable)
      .values({ guildId: guild.id, logChannelId: channel.id })
      .onConflictDoUpdate({
        target: guildSettingsTable.guildId,
        set: { logChannelId: channel.id },
      });
    await interaction.reply({
      content: `✅ Mod logs will now be posted in <#${channel.id}>.`,
      ephemeral: true,
    });
  }

  if (interaction.commandName === "setmuted") {
    const role = interaction.options.getRole("role", true);
    await db
      .insert(guildSettingsTable)
      .values({ guildId: guild.id, mutedRoleId: role.id })
      .onConflictDoUpdate({
        target: guildSettingsTable.guildId,
        set: { mutedRoleId: role.id },
      });
    await interaction.reply({
      content: `✅ Muted role set to **${role.name}**.`,
      ephemeral: true,
    });
  }
}
