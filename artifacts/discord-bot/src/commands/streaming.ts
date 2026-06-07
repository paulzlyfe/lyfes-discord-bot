import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  GuildMember,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextChannel,
} from "discord.js";
import { getStreamerLink, setStreamerLink } from "../db.js";

const STREAMER_ROLE_ID = "1513109334861807647";
const STREAM_ALERT_CHANNEL_ID = "1513110104482779276";

function hasAccess(member: GuildMember): boolean {
  return (
    member.roles.cache.has(STREAMER_ROLE_ID) ||
    member.permissions.has(PermissionFlagsBits.Administrator)
  );
}

export const setstreamerCommand = new SlashCommandBuilder()
  .setName("setstreamer")
  .setDescription("Link your YouTube or Twitch channel so the bot can announce when you go live")
  .addStringOption((o) =>
    o
      .setName("platform")
      .setDescription("Your streaming platform")
      .setRequired(true)
      .addChoices(
        { name: "YouTube", value: "youtube" },
        { name: "Twitch", value: "twitch" }
      )
  )
  .addStringOption((o) =>
    o.setName("url").setDescription("Full URL to your channel (e.g. https://twitch.tv/yourname)").setRequired(true)
  );

export const goliveCommand = new SlashCommandBuilder()
  .setName("golive")
  .setDescription("Announce that you are live — posts to the stream alert channel with @everyone");

export const offairCommand = new SlashCommandBuilder()
  .setName("offair")
  .setDescription("Post a stream ended message to the stream alert channel")
  .addStringOption((o) =>
    o.setName("message").setDescription("Optional goodbye message for your viewers").setRequired(false)
  );

export async function handleStreamingCommand(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild) {
    await interaction.reply({ content: "Must be used in a server.", ephemeral: true });
    return;
  }

  const member = interaction.member as GuildMember;
  const cmd = interaction.commandName;

  if (!hasAccess(member)) {
    await interaction.reply({
      content: "❌ You need the **Streamer** or **Owner** role to use this command.",
      ephemeral: true,
    });
    return;
  }

  try {
    if (cmd === "setstreamer") {
      const platform = interaction.options.getString("platform", true) as "youtube" | "twitch";
      const url = interaction.options.getString("url", true);

      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        await interaction.reply({ content: "❌ Please provide a full URL including `https://`.", ephemeral: true });
        return;
      }

      setStreamerLink(interaction.guild.id, interaction.user.id, platform, url);

      const platformLabel = platform === "youtube" ? "YouTube 🎬" : "Twitch 🟣";
      await interaction.reply({
        content: `✅ Your ${platformLabel} channel has been saved: <${url}>\n\nUse \`/golive\` whenever you start streaming to announce it!`,
        ephemeral: true,
      });

    } else if (cmd === "golive") {
      const link = getStreamerLink(interaction.guild.id, interaction.user.id);

      if (!link) {
        await interaction.reply({
          content: "❌ You haven't set up your channel yet. Use `/setstreamer` first.",
          ephemeral: true,
        });
        return;
      }

      const alertChannel = interaction.guild.channels.cache.get(STREAM_ALERT_CHANNEL_ID) as TextChannel | undefined;
      if (!alertChannel) {
        await interaction.reply({ content: "❌ Stream alert channel not found.", ephemeral: true });
        return;
      }

      const platformLabel = link.platform === "youtube" ? "YouTube 🎬" : "Twitch 🟣";
      const platformColor = link.platform === "youtube" ? 0xff0000 : 0x9146ff;

      const embed = new EmbedBuilder()
        .setColor(platformColor)
        .setTitle(`🔴 ${interaction.user.username} is now LIVE!`)
        .setDescription(`**${interaction.user.username}** just went live on ${platformLabel}!\n\n🔗 **Watch here:** ${link.url}`)
        .setThumbnail(interaction.user.displayAvatarURL({ size: 256 }))
        .setFooter({ text: "Come watch and show some support!" })
        .setTimestamp();

      await alertChannel.send({ content: "@everyone", embeds: [embed] });
      await interaction.reply({ content: `✅ Your stream has been announced in <#${STREAM_ALERT_CHANNEL_ID}>!`, ephemeral: true });

    } else if (cmd === "offair") {
      const link = getStreamerLink(interaction.guild.id, interaction.user.id);
      const customMessage = interaction.options.getString("message");

      const alertChannel = interaction.guild.channels.cache.get(STREAM_ALERT_CHANNEL_ID) as TextChannel | undefined;
      if (!alertChannel) {
        await interaction.reply({ content: "❌ Stream alert channel not found.", ephemeral: true });
        return;
      }

      const platformLabel = link ? (link.platform === "youtube" ? "YouTube 🎬" : "Twitch 🟣") : "their stream";
      const watchAgainLine = link ? `\n\n🔗 **Catch the VOD:** ${link.url}` : "";

      const embed = new EmbedBuilder()
        .setColor(0x36393f)
        .setTitle(`⬛ ${interaction.user.username} is now offline`)
        .setDescription(
          `**${interaction.user.username}** has ended their ${platformLabel} stream. Thanks everyone for watching!` +
          (customMessage ? `\n\n💬 *"${customMessage}"*` : "") +
          watchAgainLine
        )
        .setThumbnail(interaction.user.displayAvatarURL({ size: 256 }))
        .setFooter({ text: "See you next time!" })
        .setTimestamp();

      await alertChannel.send({ embeds: [embed] });
      await interaction.reply({ content: `✅ Stream ended message posted in <#${STREAM_ALERT_CHANNEL_ID}>!`, ephemeral: true });
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
