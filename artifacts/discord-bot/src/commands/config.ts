import {
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import {
  addIgnoredChannel,
  getGuildConfig,
  getIgnoredChannels,
  removeIgnoredChannel,
  updateIgnoredChannel,
  setAutomod,
  setBannedWords,
  setLogChannel,
  setMemberLogChannel,
  type IgnoredChannelScope,
} from "../db.js";

export const setlogCommand = new SlashCommandBuilder()
  .setName("setlog")
  .setDescription("Set the channel for mod action logs")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addChannelOption((o) =>
    o.setName("channel").setDescription("Log channel").setRequired(true)
  );

export const setmemberlogCommand = new SlashCommandBuilder()
  .setName("setmemberlog")
  .setDescription("Set the channel where member joins and leaves are logged")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addChannelOption((o) =>
    o.setName("channel").setDescription("Member log channel").setRequired(true)
  );

export const automodCommand = new SlashCommandBuilder()
  .setName("automod")
  .setDescription("Enable or disable auto-moderation")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addBooleanOption((o) =>
    o.setName("enabled").setDescription("Enable or disable").setRequired(true)
  );

export const ignorechannelCommand = new SlashCommandBuilder()
  .setName("ignorechannel")
  .setDescription("Manage channels ignored by logging and/or auto-mod")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sub) =>
    sub
      .setName("add")
      .setDescription("Ignore a channel for logging, auto-mod, or both")
      .addChannelOption((o) =>
        o.setName("channel").setDescription("Channel to ignore").setRequired(true)
      )
      .addStringOption((o) =>
        o
          .setName("scope")
          .setDescription("What to disable for this channel (default: both)")
          .setRequired(false)
          .addChoices(
            { name: "both (logging + auto-mod)", value: "both" },
            { name: "automod only", value: "automod" },
            { name: "logging only", value: "logging" }
          )
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("remove")
      .setDescription("Stop ignoring a channel")
      .addChannelOption((o) =>
        o.setName("channel").setDescription("Channel to stop ignoring").setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("update")
      .setDescription("Change the ignore scope of an already-ignored channel")
      .addChannelOption((o) =>
        o.setName("channel").setDescription("Channel to update").setRequired(true)
      )
      .addStringOption((o) =>
        o
          .setName("scope")
          .setDescription("New scope to apply")
          .setRequired(true)
          .addChoices(
            { name: "both (logging + auto-mod)", value: "both" },
            { name: "automod only", value: "automod" },
            { name: "logging only", value: "logging" }
          )
      )
  )
  .addSubcommand((sub) =>
    sub.setName("list").setDescription("List all ignored channels")
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
      await setLogChannel(guildId, channel.id);
      await interaction.reply({ content: `✅ Mod logs will be sent to <#${channel.id}>.`, ephemeral: true });

    } else if (cmd === "setmemberlog") {
      const channel = interaction.options.getChannel("channel", true);
      await setMemberLogChannel(guildId, channel.id);
      await interaction.reply({ content: `✅ Member join/leave logs will be sent to <#${channel.id}>.`, ephemeral: true });

    } else if (cmd === "automod") {
      const enabled = interaction.options.getBoolean("enabled", true);
      await setAutomod(guildId, enabled);
      await interaction.reply({ content: `✅ AutoMod is now **${enabled ? "enabled" : "disabled"}**.`, ephemeral: true });

    } else if (cmd === "bannedwords") {
      const sub = interaction.options.getSubcommand();
      const config = await getGuildConfig(guildId);
      const words: string[] = config.banned_words;

      if (sub === "list") {
        await interaction.reply({
          content: words.length === 0 ? "No banned words set." : `Banned words:\n${words.map((w) => `\`${w}\``).join(", ")}`,
          ephemeral: true,
        });
      } else if (sub === "add") {
        const word = interaction.options.getString("word", true).toLowerCase();
        if (!words.includes(word)) words.push(word);
        await setBannedWords(guildId, words);
        await interaction.reply({ content: `✅ Added \`${word}\` to the banned words list.`, ephemeral: true });
      } else if (sub === "remove") {
        const word = interaction.options.getString("word", true).toLowerCase();
        const filtered = words.filter((w) => w !== word);
        await setBannedWords(guildId, filtered);
        await interaction.reply({ content: `✅ Removed \`${word}\` from the banned words list.`, ephemeral: true });
      }
    } else if (cmd === "ignorechannel") {
      await interaction.deferReply({ flags: 64 });
      const sub = interaction.options.getSubcommand();

      if (sub === "list") {
        const entries = await getIgnoredChannels(guildId);
        const scopeLabel: Record<string, string> = {
          both: "logging + auto-mod",
          automod: "auto-mod only",
          logging: "logging only",
        };
        await interaction.editReply({
          content: entries.length === 0
            ? "No channels are currently ignored."
            : `**Ignored channels:**\n${entries.map((e) => `<#${e.channelId}> — ${scopeLabel[e.scope] ?? e.scope}`).join("\n")}`,
        });
      } else if (sub === "add") {
        const ch = interaction.options.getChannel("channel", true);
        const scope = (interaction.options.getString("scope") ?? "both") as IgnoredChannelScope;
        await addIgnoredChannel(guildId, ch.id, scope);
        const scopeMsg: Record<IgnoredChannelScope, string> = {
          both: "auto-mod and logging will both skip it",
          automod: "auto-mod will skip it (logging still active)",
          logging: "logging will skip it (auto-mod still active)",
        };
        await interaction.editReply({
          content: `✅ <#${ch.id}> is now ignored — ${scopeMsg[scope]}.`,
        });
      } else if (sub === "update") {
        const ch = interaction.options.getChannel("channel", true);
        const scope = interaction.options.getString("scope", true) as IgnoredChannelScope;
        const updated = await updateIgnoredChannel(guildId, ch.id, scope);
        if (!updated) {
          await interaction.editReply({
            content: `❌ <#${ch.id}> is not ignored yet. Use \`/ignorechannel add\` first.`,
          });
          return;
        }
        const scopeMsg: Record<IgnoredChannelScope, string> = {
          both: "auto-mod and logging will both skip it",
          automod: "auto-mod will skip it (logging still active)",
          logging: "logging will skip it (auto-mod still active)",
        };
        await interaction.editReply({
          content: `✅ <#${ch.id}> ignore scope updated — ${scopeMsg[scope]}.`,
        });
      } else if (sub === "remove") {
        const ch = interaction.options.getChannel("channel", true);
        await removeIgnoredChannel(guildId, ch.id);
        await interaction.editReply({
          content: `✅ <#${ch.id}> is no longer ignored.`,
        });
      }
    }
  } catch (err: any) {
    const msg = `❌ ${err.message}`;
    if (interaction.replied || interaction.deferred) {
      await interaction.editReply({ content: msg }).catch(() => {});
    } else {
      await interaction.reply({ content: msg, flags: 64 }).catch(() => {});
    }
  }
}
