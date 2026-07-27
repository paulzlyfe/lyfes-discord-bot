import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  type ChatInputCommandInteraction,
} from "discord.js";
import { db } from "@workspace/db";
import { guildSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export const automodCommands = [
  new SlashCommandBuilder()
    .setName("addword")
    .setDescription("Add a word to the automod banned words list")
    .addStringOption((o) =>
      o.setName("word").setDescription("Word to ban").setRequired(true),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),

  new SlashCommandBuilder()
    .setName("removeword")
    .setDescription("Remove a word from the automod banned words list")
    .addStringOption((o) =>
      o.setName("word").setDescription("Word to remove").setRequired(true),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),

  new SlashCommandBuilder()
    .setName("ignore")
    .setDescription("Toggle automod ignore for a channel")
    .addChannelOption((o) =>
      o
        .setName("channel")
        .setDescription("Channel to toggle")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),
];

export async function handleAutomodCmds(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const guild = interaction.guild!;
  const [settings] = await db
    .select()
    .from(guildSettingsTable)
    .where(eq(guildSettingsTable.guildId, guild.id));

  if (interaction.commandName === "addword") {
    const word = interaction.options.getString("word", true).toLowerCase();
    const current = settings?.bannedWords ?? [];
    if (current.includes(word)) {
      await interaction.reply({ content: `"${word}" is already in the banned words list.`, ephemeral: true });
      return;
    }
    const updated = [...current, word];
    await db
      .insert(guildSettingsTable)
      .values({ guildId: guild.id, bannedWords: updated })
      .onConflictDoUpdate({ target: guildSettingsTable.guildId, set: { bannedWords: updated } });
    await interaction.reply({ content: `✅ Added "${word}" to the banned words list.`, ephemeral: true });
  }

  if (interaction.commandName === "removeword") {
    const word = interaction.options.getString("word", true).toLowerCase();
    const updated = (settings?.bannedWords ?? []).filter((w) => w !== word);
    await db
      .insert(guildSettingsTable)
      .values({ guildId: guild.id, bannedWords: updated })
      .onConflictDoUpdate({ target: guildSettingsTable.guildId, set: { bannedWords: updated } });
    await interaction.reply({ content: `✅ Removed "${word}" from the banned words list.`, ephemeral: true });
  }

  if (interaction.commandName === "ignore") {
    const channel = interaction.options.getChannel("channel", true);
    const current = settings?.ignoredChannelIds ?? [];
    const isIgnored = current.includes(channel.id);
    const updated = isIgnored
      ? current.filter((id) => id !== channel.id)
      : [...current, channel.id];
    await db
      .insert(guildSettingsTable)
      .values({ guildId: guild.id, ignoredChannelIds: updated })
      .onConflictDoUpdate({ target: guildSettingsTable.guildId, set: { ignoredChannelIds: updated } });
    await interaction.reply({
      content: isIgnored
        ? `✅ Automod re-enabled in <#${channel.id}>.`
        : `✅ Automod will now ignore <#${channel.id}>.`,
      ephemeral: true,
    });
  }
}
