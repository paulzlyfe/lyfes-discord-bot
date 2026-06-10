import {
  Client,
  EmbedBuilder,
  TextChannel,
  Message,
  PartialMessage,
  VoiceState,
  GuildMember,
  PartialGuildMember,
  AuditLogEvent,
} from "discord.js";
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
  VOICE_JOIN: 0x2ecc71,
  VOICE_LEAVE: 0xe74c3c,
  VOICE_MOVE: 0xf39c12,
  MUTE: 0xf1c40f,
  UNMUTE: 0x2ecc71,
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

export async function sendVoiceLog(
  client: Client,
  oldState: VoiceState,
  newState: VoiceState
) {
  const guild = newState.guild;
  const member = newState.member;
  if (!member || member.user.bot) return;

  const channel = await getLogChannel(client, guild.id);
  if (!channel) return;

  const joined = !oldState.channelId && !!newState.channelId;
  const left = !!oldState.channelId && !newState.channelId;
  const moved = !!oldState.channelId && !!newState.channelId && oldState.channelId !== newState.channelId;

  if (!joined && !left && !moved) return;

  let title: string;
  let color: number;
  const fields: { name: string; value: string; inline?: boolean }[] = [
    { name: "Member", value: `${member.user.tag} (<@${member.id}>)`, inline: true },
  ];

  if (joined) {
    title = "🔊 Joined Voice Channel";
    color = COLORS.VOICE_JOIN;
    fields.push({ name: "Channel", value: `<#${newState.channelId}>`, inline: true });
  } else if (left) {
    title = "🔇 Left Voice Channel";
    color = COLORS.VOICE_LEAVE;
    fields.push({ name: "Channel", value: `<#${oldState.channelId}>`, inline: true });
  } else {
    title = "🔀 Moved Voice Channel";
    color = COLORS.VOICE_MOVE;
    fields.push(
      { name: "From", value: `<#${oldState.channelId}>`, inline: true },
      { name: "To", value: `<#${newState.channelId}>`, inline: true },
    );

    // Try to find who moved them via audit log
    try {
      const auditLogs = await guild.fetchAuditLogs({ type: AuditLogEvent.MemberMove, limit: 5 });
      const entry = auditLogs.entries.find(
        (e) => Date.now() - e.createdTimestamp < 5000
      );
      if (entry?.executor) {
        fields.push({ name: "Moved by", value: `${entry.executor.tag} (<@${entry.executor.id}>)`, inline: true });
      }
    } catch {
      // Missing audit log permission — skip
    }
  }

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .addFields(fields)
    .setTimestamp();

  await channel.send({ embeds: [embed] }).catch(() => {});
}

export async function sendMuteLog(
  client: Client,
  oldMember: GuildMember | PartialGuildMember,
  newMember: GuildMember
) {
  if (newMember.user.bot) return;

  const oldTimeout = oldMember.communicationDisabledUntil;
  const newTimeout = newMember.communicationDisabledUntil;

  const wasMuted = oldTimeout && oldTimeout > new Date();
  const isMuted = newTimeout && newTimeout > new Date();

  if (wasMuted === isMuted) return; // No change

  const channel = await getLogChannel(client, newMember.guild.id);
  if (!channel) return;

  const action = isMuted ? "MUTE" : "UNMUTE";
  const title = isMuted ? "🔇 Member Timed Out" : "🔊 Timeout Removed";

  const fields: { name: string; value: string; inline?: boolean }[] = [
    { name: "Member", value: `${newMember.user.tag} (<@${newMember.id}>)`, inline: true },
  ];

  if (isMuted && newTimeout) {
    fields.push({ name: "Expires", value: `<t:${Math.floor(newTimeout.getTime() / 1000)}:R>`, inline: true });
  }

  // Try to find who issued the timeout via audit log
  try {
    const auditLogs = await newMember.guild.fetchAuditLogs({ type: AuditLogEvent.MemberUpdate, limit: 5 });
    const entry = auditLogs.entries.find(
      (e) => e.target?.id === newMember.id && Date.now() - e.createdTimestamp < 5000
    );
    if (entry?.executor) {
      fields.push({ name: "By", value: `${entry.executor.tag} (<@${entry.executor.id}>)`, inline: true });
    }
  } catch {
    // Missing audit log permission — skip
  }

  const embed = new EmbedBuilder()
    .setColor(COLORS[action])
    .setTitle(title)
    .addFields(fields)
    .setTimestamp();

  await channel.send({ embeds: [embed] }).catch(() => {});
}
