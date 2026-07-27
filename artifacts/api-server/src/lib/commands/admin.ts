import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
} from "discord.js";
import { db } from "@workspace/db";
import { guildSettingsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

export const adminCommands = [
  new SlashCommandBuilder()
    .setName("setadmin")
    .setDescription("Grant a role bot-admin permissions")
    .addRoleOption((o) =>
      o.setName("role").setDescription("Role to grant admin access").setRequired(true),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),

  new SlashCommandBuilder()
    .setName("removeadmin")
    .setDescription("Remove bot-admin permissions from a role")
    .addRoleOption((o) =>
      o.setName("role").setDescription("Role to remove admin access from").setRequired(true),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),
];

export async function handleAdmin(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const guild = interaction.guild!;

  if (interaction.commandName === "setadmin") {
    const role = interaction.options.getRole("role", true);
    const [settings] = await db.select().from(guildSettingsTable).where(eq(guildSettingsTable.guildId, guild.id));
    const current = settings?.adminRoleIds ?? [];
    if (current.includes(role.id)) {
      await interaction.reply({ content: `**${role.name}** already has bot-admin access.`, ephemeral: true });
      return;
    }
    await db
      .insert(guildSettingsTable)
      .values({ guildId: guild.id, adminRoleIds: [role.id] })
      .onConflictDoUpdate({
        target: guildSettingsTable.guildId,
        set: { adminRoleIds: sql`array_append(${guildSettingsTable.adminRoleIds}, ${role.id})` },
      });
    await interaction.reply({ content: `✅ **${role.name}** now has bot-admin access.`, ephemeral: true });
  }

  if (interaction.commandName === "removeadmin") {
    const role = interaction.options.getRole("role", true);
    const [settings] = await db.select().from(guildSettingsTable).where(eq(guildSettingsTable.guildId, guild.id));
    const updated = (settings?.adminRoleIds ?? []).filter((id) => id !== role.id);
    await db
      .insert(guildSettingsTable)
      .values({ guildId: guild.id, adminRoleIds: updated })
      .onConflictDoUpdate({
        target: guildSettingsTable.guildId,
        set: { adminRoleIds: updated },
      });
    await interaction.reply({ content: `✅ Bot-admin access removed from **${role.name}**.`, ephemeral: true });
  }
}
