import { Client, EmbedBuilder, TextChannel } from "discord.js";
import { getGuildConfig } from "./db.js";

const COLORS: Record<string, number> = {
  BAN: 0xe74c3c,
  UNBAN: 0x2ecc71,
  KICK: 0xe67e22,
  TIMEOUT: 0xf39c12,
  WARN: 0xf1c40f,
  CLEAR: 0x3498db,
  AUTOMOD_TIMEOUT: 0xe67e22,
  AUTOMOD_DELETE: 0x95a5a6,
};

export async function sendModLog(
  client: Client,
  guildId: string,
  action: string,
  targetTag: string,
  targetId: string,
  moderatorTag: string,
  reason?: string,
  extra?: string
) {
  const config = await getGuildConfig(guildId);
  if (!config.log_channel_id) return;

  const channel = client.channels.cache.get(config.log_channel_id) as
    | TextChannel
    | undefined;
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setColor(COLORS[action] ?? 0x7f8c8d)
    .setTitle(`🔨 ${action}`)
    .addFields(
      { name: "User", value: `${targetTag} (${targetId})`, inline: true },
      { name: "Moderator", value: moderatorTag, inline: true }
    )
    .setTimestamp();

  if (reason) embed.addFields({ name: "Reason", value: reason });
  if (extra) embed.addFields({ name: "Details", value: extra });

  await channel.send({ embeds: [embed] }).catch(() => {});
}
