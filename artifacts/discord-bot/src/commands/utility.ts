import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  GuildMember,
  SlashCommandBuilder,
} from "discord.js";
import { getWarnings } from "../db.js";

export const pingCommand = new SlashCommandBuilder()
  .setName("ping")
  .setDescription("Check the bot's latency");

export const userinfoCommand = new SlashCommandBuilder()
  .setName("userinfo")
  .setDescription("Show info about a member")
  .addUserOption((o) =>
    o.setName("user").setDescription("Member to look up (defaults to you)").setRequired(false)
  );

export async function handleUtilityCommand(interaction: ChatInputCommandInteraction) {
  if (interaction.commandName === "ping") {
    const sent = await interaction.reply({ content: "Pinging…", fetchReply: true });
    const roundtrip = sent.createdTimestamp - interaction.createdTimestamp;
    const ws = interaction.client.ws.ping;

    const embed = new EmbedBuilder()
      .setColor(ws < 100 ? 0x2ecc71 : ws < 200 ? 0xf1c40f : 0xe74c3c)
      .setTitle("🏓 Pong!")
      .addFields(
        { name: "Roundtrip", value: `${roundtrip}ms`, inline: true },
        { name: "WebSocket", value: `${ws}ms`, inline: true },
      );

    await interaction.editReply({ content: "", embeds: [embed] });

  } else if (interaction.commandName === "userinfo") {
    if (!interaction.guild) {
      await interaction.reply({ content: "Must be used in a server.", ephemeral: true });
      return;
    }

    const target = interaction.options.getUser("user") ?? interaction.user;
    let member: GuildMember | null = null;
    try {
      member = await interaction.guild.members.fetch(target.id);
    } catch {
      // User not in server — show partial info
    }

    const warnings = getWarnings(interaction.guild.id, target.id);
    const accountAgeDays = Math.floor((Date.now() - target.createdTimestamp) / 86_400_000);
    const isNewAccount = accountAgeDays < 7;

    const roles = member
      ? member.roles.cache
          .filter((r) => r.id !== interaction.guild!.id)
          .sort((a, b) => b.position - a.position)
          .map((r) => `<@&${r.id}>`)
          .slice(0, 15)
          .join(" ") || "None"
      : "Not in server";

    const embed = new EmbedBuilder()
      .setColor(member?.displayColor || 0x5865f2)
      .setTitle(`${target.username}${isNewAccount ? " ⚠️ New Account" : ""}`)
      .setThumbnail(target.displayAvatarURL({ size: 256 }))
      .addFields(
        { name: "User", value: `${target.tag}\n<@${target.id}>`, inline: true },
        { name: "Account Created", value: `<t:${Math.floor(target.createdTimestamp / 1000)}:D>\n${accountAgeDays} days ago`, inline: true },
        { name: "Joined Server", value: member?.joinedTimestamp
          ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>`
          : "Not in server", inline: true },
        { name: `Roles (${member ? member.roles.cache.size - 1 : 0})`, value: roles },
        { name: "Warnings", value: warnings.length === 0
          ? "None"
          : warnings.map((w, i) => `**${i + 1}.** ${w.reason} — <t:${w.created_at}:R>`).join("\n"),
        },
      )
      .setFooter({ text: `ID: ${target.id}` })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }
}
