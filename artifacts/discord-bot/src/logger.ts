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
  Role,
  GuildChannel,
  ChannelType,
  PermissionsBitField,
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
  ROLE_CREATE: 0x2ecc71,
  ROLE_DELETE: 0xe74c3c,
  ROLE_EDIT: 0x3498db,
  ROLE_ASSIGN: 0x2ecc71,
  ROLE_REMOVE: 0xe74c3c,
  CHANNEL_CREATE: 0x2ecc71,
  CHANNEL_DELETE: 0xe74c3c,
  CHANNEL_MOVE: 0xf39c12,
};

function channelTypeName(type: ChannelType): string {
  const map: Partial<Record<ChannelType, string>> = {
    [ChannelType.GuildText]: "Text",
    [ChannelType.GuildVoice]: "Voice",
    [ChannelType.GuildCategory]: "Category",
    [ChannelType.GuildAnnouncement]: "Announcement",
    [ChannelType.GuildForum]: "Forum",
    [ChannelType.GuildStageVoice]: "Stage",
    [ChannelType.GuildMedia]: "Media",
  };
  return map[type] ?? "Channel";
}

async function getLogChannel(client: Client, guildId: string): Promise<TextChannel | undefined> {
  const config = await getGuildConfig(guildId);
  const channelId = config.log_channel_id ?? HARDCODED_LOG_CHANNEL;
  return client.channels.cache.get(channelId) as TextChannel | undefined;
}

// ─── Mod actions (ban/kick/warn etc.) ────────────────────────────────────────

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

// ─── Message delete/edit ─────────────────────────────────────────────────────

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

  embed.addFields({
    name: "Content",
    value: message.content ? message.content.slice(0, 1024) : "*Not cached or attachment only*",
  });

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

// ─── Voice channel events ────────────────────────────────────────────────────

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

  const fields: { name: string; value: string; inline?: boolean }[] = [
    { name: "Member", value: `${member.user.tag} (<@${member.id}>)`, inline: true },
  ];

  let title: string;
  let color: number;

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
    try {
      const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.MemberMove, limit: 5 });
      const entry = logs.entries.find((e) => Date.now() - e.createdTimestamp < 5000);
      if (entry?.executor) {
        fields.push({ name: "Moved by", value: `${entry.executor.tag} (<@${entry.executor.id}>)`, inline: true });
      }
    } catch { /* no audit log permission */ }
  }

  await channel.send({
    embeds: [new EmbedBuilder().setColor(color).setTitle(title).addFields(fields).setTimestamp()],
  }).catch(() => {});
}

// ─── Mute / timeout ──────────────────────────────────────────────────────────

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
  if (!!wasMuted === !!isMuted) return;

  const channel = await getLogChannel(client, newMember.guild.id);
  if (!channel) return;

  const action = isMuted ? "MUTE" : "UNMUTE";
  const fields: { name: string; value: string; inline?: boolean }[] = [
    { name: "Member", value: `${newMember.user.tag} (<@${newMember.id}>)`, inline: true },
  ];

  if (isMuted && newTimeout) {
    fields.push({ name: "Expires", value: `<t:${Math.floor(newTimeout.getTime() / 1000)}:R>`, inline: true });
  }

  try {
    const logs = await newMember.guild.fetchAuditLogs({ type: AuditLogEvent.MemberUpdate, limit: 5 });
    const entry = logs.entries.find((e) => e.target?.id === newMember.id && Date.now() - e.createdTimestamp < 5000);
    if (entry?.executor) {
      fields.push({ name: "By", value: `${entry.executor.tag} (<@${entry.executor.id}>)`, inline: true });
    }
  } catch { /* no audit log permission */ }

  await channel.send({
    embeds: [new EmbedBuilder()
      .setColor(COLORS[action])
      .setTitle(isMuted ? "🔇 Member Timed Out" : "🔊 Timeout Removed")
      .addFields(fields)
      .setTimestamp()],
  }).catch(() => {});
}

// ─── Member role changes ──────────────────────────────────────────────────────

export async function sendMemberRoleLog(
  client: Client,
  oldMember: GuildMember | PartialGuildMember,
  newMember: GuildMember
) {
  if (newMember.user.bot) return;

  const oldRoles = oldMember.roles?.cache ?? new Map();
  const newRoles = newMember.roles.cache;

  const added = newRoles.filter((r) => !oldRoles.has(r.id) && r.id !== newMember.guild.id);
  const removed = oldRoles.filter((r: Role) => !newRoles.has(r.id) && r.id !== newMember.guild.id);

  if (added.size === 0 && removed.size === 0) return;

  const channel = await getLogChannel(client, newMember.guild.id);
  if (!channel) return;

  const fields: { name: string; value: string; inline?: boolean }[] = [
    { name: "Member", value: `${newMember.user.tag} (<@${newMember.id}>)`, inline: true },
  ];

  if (added.size > 0) {
    fields.push({ name: "✅ Roles Added", value: added.map((r) => `<@&${r.id}>`).join(", "), inline: false });
  }
  if (removed.size > 0) {
    fields.push({ name: "❌ Roles Removed", value: removed.map((r: Role) => `<@&${r.id}>`).join(", "), inline: false });
  }

  try {
    const type = added.size > 0 ? AuditLogEvent.MemberRoleUpdate : AuditLogEvent.MemberRoleUpdate;
    const logs = await newMember.guild.fetchAuditLogs({ type, limit: 5 });
    const entry = logs.entries.find((e) => e.target?.id === newMember.id && Date.now() - e.createdTimestamp < 5000);
    if (entry?.executor) {
      fields.push({ name: "By", value: `${entry.executor.tag} (<@${entry.executor.id}>)`, inline: true });
    }
  } catch { /* no audit log permission */ }

  const color = added.size > 0 ? COLORS.ROLE_ASSIGN : COLORS.ROLE_REMOVE;
  const title = added.size > 0 && removed.size > 0
    ? "🔄 Member Roles Changed"
    : added.size > 0 ? "➕ Role Assigned" : "➖ Role Removed";

  await channel.send({
    embeds: [new EmbedBuilder().setColor(color).setTitle(title).addFields(fields).setTimestamp()],
  }).catch(() => {});
}

// ─── Role create / delete / edit ─────────────────────────────────────────────

export async function sendRoleCreateLog(client: Client, role: Role) {
  const channel = await getLogChannel(client, role.guild.id);
  if (!channel) return;

  await channel.send({
    embeds: [new EmbedBuilder()
      .setColor(COLORS.ROLE_CREATE)
      .setTitle("✅ Role Created")
      .addFields(
        { name: "Name", value: role.name, inline: true },
        { name: "Color", value: role.hexColor, inline: true },
        { name: "Mentionable", value: role.mentionable ? "Yes" : "No", inline: true },
      )
      .setTimestamp()],
  }).catch(() => {});
}

export async function sendRoleDeleteLog(client: Client, role: Role) {
  const channel = await getLogChannel(client, role.guild.id);
  if (!channel) return;

  await channel.send({
    embeds: [new EmbedBuilder()
      .setColor(COLORS.ROLE_DELETE)
      .setTitle("❌ Role Deleted")
      .addFields({ name: "Name", value: role.name, inline: true })
      .setTimestamp()],
  }).catch(() => {});
}

export async function sendRoleUpdateLog(client: Client, oldRole: Role, newRole: Role) {
  const changes: string[] = [];

  if (oldRole.name !== newRole.name) changes.push(`**Name:** \`${oldRole.name}\` → \`${newRole.name}\``);
  if (oldRole.hexColor !== newRole.hexColor) changes.push(`**Color:** \`${oldRole.hexColor}\` → \`${newRole.hexColor}\``);
  if (oldRole.hoist !== newRole.hoist) changes.push(`**Hoisted:** ${oldRole.hoist} → ${newRole.hoist}`);
  if (oldRole.mentionable !== newRole.mentionable) changes.push(`**Mentionable:** ${oldRole.mentionable} → ${newRole.mentionable}`);

  const oldPerms = new PermissionsBitField(oldRole.permissions.bitfield);
  const newPerms = new PermissionsBitField(newRole.permissions.bitfield);
  const addedPerms = newPerms.toArray().filter((p) => !oldPerms.has(p));
  const removedPerms = oldPerms.toArray().filter((p) => !newPerms.has(p));
  if (addedPerms.length) changes.push(`**Permissions added:** ${addedPerms.join(", ")}`);
  if (removedPerms.length) changes.push(`**Permissions removed:** ${removedPerms.join(", ")}`);

  if (changes.length === 0) return;

  const channel = await getLogChannel(client, newRole.guild.id);
  if (!channel) return;

  await channel.send({
    embeds: [new EmbedBuilder()
      .setColor(COLORS.ROLE_EDIT)
      .setTitle("✏️ Role Edited")
      .addFields(
        { name: "Role", value: `<@&${newRole.id}> (${newRole.name})`, inline: true },
        { name: "Changes", value: changes.join("\n").slice(0, 1024) },
      )
      .setTimestamp()],
  }).catch(() => {});
}

// ─── Channel create / delete / move ──────────────────────────────────────────

export async function sendChannelCreateLog(client: Client, channel: GuildChannel) {
  const logChannel = await getLogChannel(client, channel.guild.id);
  if (!logChannel) return;

  await logChannel.send({
    embeds: [new EmbedBuilder()
      .setColor(COLORS.CHANNEL_CREATE)
      .setTitle("✅ Channel Created")
      .addFields(
        { name: "Name", value: `<#${channel.id}> (${channel.name})`, inline: true },
        { name: "Type", value: channelTypeName(channel.type), inline: true },
        { name: "Category", value: channel.parent?.name ?? "None", inline: true },
      )
      .setTimestamp()],
  }).catch(() => {});
}

export async function sendChannelDeleteLog(client: Client, channel: GuildChannel) {
  const logChannel = await getLogChannel(client, channel.guild.id);
  if (!logChannel) return;

  await logChannel.send({
    embeds: [new EmbedBuilder()
      .setColor(COLORS.CHANNEL_DELETE)
      .setTitle("❌ Channel Deleted")
      .addFields(
        { name: "Name", value: channel.name, inline: true },
        { name: "Type", value: channelTypeName(channel.type), inline: true },
        { name: "Category", value: channel.parent?.name ?? "None", inline: true },
      )
      .setTimestamp()],
  }).catch(() => {});
}

export async function sendChannelUpdateLog(client: Client, oldChannel: GuildChannel, newChannel: GuildChannel) {
  const changes: string[] = [];

  if (oldChannel.name !== newChannel.name) changes.push(`**Name:** \`${oldChannel.name}\` → \`${newChannel.name}\``);
  if (oldChannel.parentId !== newChannel.parentId) {
    changes.push(`**Category:** \`${oldChannel.parent?.name ?? "None"}\` → \`${newChannel.parent?.name ?? "None"}\``);
  }
  if (oldChannel.position !== newChannel.position) changes.push(`**Position:** ${oldChannel.position} → ${newChannel.position}`);

  if (changes.length === 0) return;

  const logChannel = await getLogChannel(client, newChannel.guild.id);
  if (!logChannel) return;

  await logChannel.send({
    embeds: [new EmbedBuilder()
      .setColor(COLORS.CHANNEL_MOVE)
      .setTitle("🔀 Channel Updated")
      .addFields(
        { name: "Channel", value: `<#${newChannel.id}>`, inline: true },
        { name: "Changes", value: changes.join("\n").slice(0, 1024) },
      )
      .setTimestamp()],
  }).catch(() => {});
}
