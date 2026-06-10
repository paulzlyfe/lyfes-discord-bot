import { Client, EmbedBuilder, TextChannel, Message, PartialMessage } from "discord.js";
import { getGuildConfig } from "./db.js";

const HARDCODED_LOG_CHANNEL = "1506457782742679752";

const COLORS: Record<string, number> = {
  BAN: 0xe74c3c,
  UNBAN: 0x2ecc71,
  KICK: 0xe67e22,
  TIMEOUT: 0xf39c12,
  UNTIMEOUT: 0x2ecc71,
  WARN: 0xf1c40f,
  CLEAR: 0x3498db,
  AUTOMOD_TIMEOUT: 0xe67e22,
  AUTOMOD_DELETE: 0x95a5a6,
  MESSAGE_DELETE: 0xe74c3c,
  MESSAGE_EDIT: 0x3498db,
};

async function getLogChannel(client: Client, guildId: string): Promise<TextChannel | undefined> {
  const config = await getGuildConfig(guildId);
  const channelId = config.log_channel_id ?? HARDCODED_LOG_CHANNEL;
  return client.channels.cache.get(channelId) as TextChannel | undefined;
}

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
  const channel = await getLogChannel(client, guildId);
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setColor(COLORS[action] ?? 0x7f8c8d)
    .setTitle(`🔨 ${action}`)
    .addFields(
      { name: "User", value: `${targetTag} (<@${targetId}>)`, inline: true },
      { name: "Moderator", value: moderatorTag, inline: true }
    )
    .setTimestamp();

  if (reason) embed.addFields({ name: "Reason", value: reason });
  if (extra) embed.addFields({ name: "Details", value: extra });

  await channel.send({ embeds: [embed] }).catch(() => {});
}

export async function sendMessageDeleteLog(
  client: Client,
  message: Message | PartialMessage
) {
  if (!message.guild || message.author?.bot) return;

  const channel = await getLogChannel(client, message.guild.id);
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setColor(COLORS.MESSAGE_DELETE)
    .setTitle("🗑️ Message Deleted")
    .addFields(
      { name: "Author", value: message.author ? `${message.author.tag} (<@${message.author.id}>)` : "Unknown", inline: true },
      { name: "Channel", value: `<#${message.channelId}>`, inline: true },
    )
    .setTimestamp();

  if (message.content) {
    embed.addFields({ name: "Content", value: message.content.slice(0, 1024) });
  } else {
    embed.addFields({ name: "Content", value: "*Message not cached or contained only attachments*" });
  }

  if (message.attachments?.size) {
    embed.addFields({
      name: "Attachments",
      value: message.attachments.map((a) => a.url).join("\n").slice(0, 1024),
    });
  }

  await channel.send({ embeds: [embed] }).catch(() => {});
}

export async function sendMessageEditLog(
  client: Client,
  oldMessage: Message | PartialMessage,
  newMessage: Message | PartialMessage
) {
  if (!newMessage.guild || newMessage.author?.bot) return;
  if (oldMessage.content === newMessage.content) return;

  const channel = await getLogChannel(client, newMessage.guild.id);
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setColor(COLORS.MESSAGE_EDIT)
    .setTitle("✏️ Message Edited")
    .setURL(newMessage.url)
    .addFields(
      { name: "Author", value: newMessage.author ? `${newMessage.author.tag} (<@${newMessage.author.id}>)` : "Unknown", inline: true },
      { name: "Channel", value: `<#${newMessage.channelId}>`, inline: true },
      { name: "Before", value: (oldMessage.content || "*Not cached*").slice(0, 1024) },
      { name: "After", value: (newMessage.content || "*Empty*").slice(0, 1024) },
    )
    .setTimestamp();

  await channel.send({ embeds: [embed] }).catch(() => {});
}
