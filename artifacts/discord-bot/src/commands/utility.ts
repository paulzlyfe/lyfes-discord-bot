import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from "discord.js";

export const pingCommand = new SlashCommandBuilder()
  .setName("ping")
  .setDescription("Check the bot's latency");

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
  }
}
