import { EmbedBuilder, Guild, Message, PermissionFlagsBits } from "discord.js";
import { addWarning, getGuildConfig, getIgnoredChannels, logAction } from "./db.js";

const LUCKY_ONES_ROLE_ID = "1506445605981913199";

// Roles exempt from all automod — matched by ID (Lucky Ones) or name (case-insensitive).
const EXEMPT_ROLE_NAMES = new Set(["lucky ones", "boss man", "chosen ones"]);

const DISCORD_INVITE_RE = /discord(?:\.gg|(?:app)?\.com\/invite)\/[a-zA-Z0-9-]+/i;
const URL_RE = /(?:https?:\/\/|www\.)\S+/gi;

// ── Cross-channel link tracker ───────────────────────────────────────────────
// Tracks how many links a user has posted across ALL channels in a time window.
// Key: "guildId:userId"  Value: { count, resetAt }
const linkTracker = new Map<string, { count: number; resetAt: number }>();
const LINK_WINDOW_MS = 60 * 60 * 1000; // 1 hour rolling window
const LINK_THRESHOLD = 3;              // warn + mute after this many links

// ── Cross-channel duplicate-text tracker ─────────────────────────────────────
// Detects the same message posted in 2+ different channels within a time window.
// Key: "guildId:userId:normalised-content"  Value: { channels: Set, resetAt }
const dupTextTracker = new Map<string, { channels: Set<string>; resetAt: number }>();
const DUP_TEXT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

// ── Same-channel rapid spam tracker ──────────────────────────────────────────
const spamTracker = new Map<string, { count: number; firstMessageAt: number }>();

// ─────────────────────────────────────────────────────────────────────────────

function isExempt(message: Message): boolean {
  const member = message.member;
  if (!member) return false;
  if (member.roles.cache.has(LUCKY_ONES_ROLE_ID)) return true;
  return member.roles.cache.some((r) => EXEMPT_ROLE_NAMES.has(r.name.toLowerCase()));
}

/** Returns a mention string for the best "staff" role in the guild. */
async function staffMention(guild: Guild): Promise<string> {
  const STAFF_NAMES = ["staff", "mod", "moderator", "admin", "administrator"];
  const byName = guild.roles.cache.find(
    (r) => r.id !== guild.id && STAFF_NAMES.some((n) => r.name.toLowerCase().includes(n))
  );
  if (byName) return `<@&${byName.id}>`;

  const byPerm = guild.roles.cache
    .filter((r) => r.id !== guild.id && !r.managed && r.permissions.has(PermissionFlagsBits.ManageMessages))
    .sort((a, b) => b.position - a.position)
    .first();
  return byPerm ? `<@&${byPerm.id}>` : "@here";
}

/**
 * Warn the user, mute them for 10 minutes, send a notice in the channel,
 * and post an alert to the server log channel pinging staff for manual review.
 */
async function warnAndMute(message: Message, reason: string): Promise<void> {
  const { guild, author, channel, member, client } = message;
  if (!guild || !member) return;

  await addWarning(guild.id, author.id, client.user!.id, reason).catch(() => {});
  await logAction(guild.id, "AUTOMOD_WARN_MUTE", author.id, client.user!.id, reason).catch(() => {});

  try {
    await member.timeout(10 * 60 * 1000, `AutoMod: ${reason}`);
  } catch { /* no permission to mute */ }

  const notice = await (channel as import("discord.js").TextChannel)
    .send(`⚠️ ${author}, you have been warned and muted for 10 minutes. Reason: **${reason}**`)
    .catch(() => null);
  if (notice) setTimeout(() => notice.delete().catch(() => {}), 8000);

  const config = await getGuildConfig(guild.id).catch(() => null);
  const logChannelId = config?.log_channel_id ?? "1506457782742679752";
  const logCh = client.channels.cache.get(logChannelId) as import("discord.js").TextChannel | undefined;
  if (!logCh) return;

  const ping = await staffMention(guild);
  const embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle("🚨 AutoMod — Manual Review Required")
    .addFields(
      { name: "User", value: `${author.tag} (<@${author.id}>)`, inline: true },
      { name: "Action", value: "Warn + Mute (10 min)", inline: true },
      { name: "Reason", value: reason },
      { name: "Channel", value: `<#${channel.id}>`, inline: true },
    )
    .setTimestamp();

  await logCh
    .send({ content: `${ping} — a user was flagged by AutoMod and needs manual review.`, embeds: [embed] })
    .catch(() => {});
}

async function deleteAndWarn(
  message: Message,
  reason: string,
  userNotice: string,
  action: string
) {
  try { await message.delete(); } catch {}

  await addWarning(guild_id(message), message.author.id, message.client.user!.id, reason).catch(() => {});
  await logAction(guild_id(message), action, message.author.id, message.client.user!.id, reason).catch(() => {});

  const notice = await (message.channel as import("discord.js").TextChannel)
    .send(`${message.author}, ${userNotice}`)
    .catch(() => null);
  if (notice) setTimeout(() => notice.delete().catch(() => {}), 6000);
}

function guild_id(m: Message): string { return m.guild!.id; }

// ─────────────────────────────────────────────────────────────────────────────

export async function runAutomod(message: Message) {
  if (!message.guild || message.author.bot) return;

  const config = await getGuildConfig(message.guild.id);
  if (!config.automod_enabled) return;

  const ignoredChannels = await getIgnoredChannels(message.guild.id);
  if (ignoredChannels.includes(message.channelId)) return;

  if (isExempt(message)) return;

  const content = message.content;
  const contentLower = content.toLowerCase();
  const guildId = message.guild.id;
  const userId = message.author.id;
  const channelId = message.channelId;
  const now = Date.now();
  const key = `${guildId}:${userId}`;

  // ── Discord invite link — instant delete + warn ───────────────────────────
  if (DISCORD_INVITE_RE.test(content)) {
    await deleteAndWarn(
      message,
      "Posted a Discord invite link",
      "posting Discord server invites is not allowed here. **Warning issued.**",
      "AUTOMOD_INVITE"
    );
    return;
  }

  // ── Cross-channel link tracker ────────────────────────────────────────────
  // Count ALL URLs in this message; accumulate across channels over 1 hour.
  const urlMatches = content.match(URL_RE);
  if (urlMatches && urlMatches.length > 0) {
    const entry = linkTracker.get(key);
    let current = entry && now < entry.resetAt ? entry : { count: 0, resetAt: now + LINK_WINDOW_MS };
    current.count += urlMatches.length;
    linkTracker.set(key, current);

    if (current.count > LINK_THRESHOLD) {
      linkTracker.delete(key); // reset so they aren't muted on every subsequent message
      await warnAndMute(
        message,
        `Posted more than ${LINK_THRESHOLD} links across channels (${current.count} total in the last hour)`
      );
      return;
    }
  }

  // ── Cross-channel duplicate-text spam ────────────────────────────────────
  // Warn + mute if the SAME text is sent in 2 or more different channels.
  const normalised = content.trim().toLowerCase().replace(/\s+/g, " ");
  if (normalised.length >= 5) { // ignore very short messages
    const dupKey = `${key}:${normalised}`;
    const dupEntry = dupTextTracker.get(dupKey);
    let dup = dupEntry && now < dupEntry.resetAt
      ? dupEntry
      : { channels: new Set<string>(), resetAt: now + DUP_TEXT_WINDOW_MS };
    dup.channels.add(channelId);
    dupTextTracker.set(dupKey, dup);

    if (dup.channels.size >= 2) {
      dupTextTracker.delete(dupKey);
      await warnAndMute(
        message,
        `Spammed the same message in ${dup.channels.size} channels`
      );
      return;
    }
  }

  // ── Banned word detection ─────────────────────────────────────────────────
  const hit = config.banned_words.find((w: string) => contentLower.includes(w.toLowerCase()));
  if (hit) {
    await deleteAndWarn(
      message,
      `Used a forbidden word: ${hit}`,
      "your message was removed for containing a forbidden word. **Warning issued.**",
      "AUTOMOD_BANNED_WORD"
    );
    return;
  }

  // ── Same-channel rapid spam detection ────────────────────────────────────
  const tracker = spamTracker.get(key) ?? { count: 0, firstMessageAt: now };
  if (now - tracker.firstMessageAt > config.spam_window_ms) {
    spamTracker.set(key, { count: 1, firstMessageAt: now });
  } else {
    tracker.count++;
    spamTracker.set(key, tracker);
    if (tracker.count >= config.spam_threshold) {
      spamTracker.delete(key);
      try {
        await message.member?.timeout(60_000, "AutoMod: Spam detected");
        await logAction(
          guildId,
          "AUTOMOD_TIMEOUT",
          userId,
          message.client.user!.id,
          "Spam detected",
          `${tracker.count} messages in ${config.spam_window_ms}ms`
        );
        const warn = await message.reply(
          `${message.author}, you've been muted for 1 minute for spamming.`
        ).catch(() => null);
        if (warn) setTimeout(() => warn.delete().catch(() => {}), 5000);
      } catch {}
    }
  }
}
