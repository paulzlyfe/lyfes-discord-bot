import {
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import {
  getGuildConfig,
  setAutomod,
  setBannedWords,
  setLogChannel,
} from "../db.js";

export const setlogCommand = new SlashCommandBuilder()
  .setName("setlog")
  .setDescription("Set the channel for mod action logs")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addChannelOption((o) =>
    o.setName("channel").setDescription("Log channel").setRequired(true)
  );

export const automodCommand = new SlashCommandBuilder()
  .setName("automod")
  .setDescription("Enable or disable auto-moderation")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addBooleanOption((o) =>
    o.setName("enabled").setDescription("Enable or disable").setRequired(true)
  );

export const bannedwordsCommand = new SlashCommandBuilder()
  .setName("bannedwords")
  .setDescription("Manage the banned words list")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((sub) =>
    sub
      .setName("add")
      .setDescription("Add a banned word")
      .addStringOption((o) => o.setName("word").setDescription("Word to ban").setRequired(true))
  )
  .addSubcommand((sub) =>
    sub
      .setName("remove")
      .setDescription("Remove a banned word")
      .addStringOption((o) => o.setName("word").setDescription("Word to remove").setRequired(true))
  )
  .addSubcommand((sub) => sub.setName("list").setDescription("List all banned words"));

export async function handleConfigCommand(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild) {
    await interaction.reply({ content: "Must be used in a server.", ephemeral: true });
    return;
  }

  const guildId = interaction.guild.id;
  const cmd = interaction.commandName;

  try {
    if (cmd === "setlog") {
      const channel = interaction.options.getChannel("channel", true);
      setLogChannel(guildId, channel.id);
      await interaction.reply({ content: `✅ Mod logs will be sent to <#${channel.id}>.`, ephemeral: true });

    } else if (cmd === "automod") {
      const enabled = interaction.options.getBoolean("enabled", true);
      setAutomod(guildId, enabled);
      await interaction.reply({ content: `✅ AutoMod is now **${enabled ? "enabled" : "disabled"}**.`, ephemeral: true });

    } else if (cmd === "bannedwords") {
      const sub = interaction.options.getSubcommand();
      const config = getGuildConfig(guildId);
      const words: string[] = config.banned_words;

      if (sub === "list") {
        await interaction.reply({
          content: words.length === 0 ? "No banned words set." : `Banned words:\n${words.map((w) => `\`${w}\``).join(", ")}`,
          ephemeral: true,
        });
      } else if (sub === "add") {
        const word = interaction.options.getString("word", true).toLowerCase();
        if (!words.includes(word)) words.push(word);
        setBannedWords(guildId, words);
        await interaction.reply({ content: `✅ Added \`${word}\` to the banned words list.`, ephemeral: true });
      } else if (sub === "remove") {
        const word = interaction.options.getString("word", true).toLowerCase();
        const filtered = words.filter((w) => w !== word);
        setBannedWords(guildId, filtered);
        await interaction.reply({ content: `✅ Removed \`${word}\` from the banned words list.`, ephemeral: true });
      }
    }
  } catch (err: any) {
    const msg = `❌ ${err.message}`;
    if (interaction.replied || interaction.deferred) {
      await interaction.editReply({ content: msg }).catch(() => {});
    } else {
      await interaction.reply({ content: msg, ephemeral: true }).catch(() => {});
    }
  }
}
