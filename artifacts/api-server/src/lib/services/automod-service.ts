import type { Message, GuildMember, TextChannel } from "discord.js";
import { EmbedBuilder } from "discord.js";
import { db } from "@workspace/db";
import { guildSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../logger";

// Per-guild spam tracking: userId -> timestamps of recent messages
const spamMap = new Map<string, Map<string, number[]>>();

const URL_REGEX = /https?:\/\/[^\s]+/i;
const SPAM_THRESHOLD = 5; // messages
const SPAM_WINDOW_MS = 5000; // 5 seconds

async function postLog(
  logChannelId: string,
  embed: EmbedBuilder,
  client: import("discord.js").Client,
): Promise<void> {
  try {
    const ch = await client.channels.fetch(logChannelId);
    if (ch?.isTextBased()) await (ch as TextChannel).send({ embeds: [embed] });
  } catch {}
}

export async function handleAutomod(message: Message): Promise<void> {
  if (!message.guild || message.author.bot) return;

  const member = message.member as GuildMember;
  // Admins and manage-guild perms bypass automod
  if (
    member.permissions.has("Administrator") ||
    member.permissions.has("ManageGuild")
  ) return;

  const [settings] = await db
    .select()
    .from(guildSettingsTable)
    .where(eq(guildSettingsTable.guildId, message.guild.id))
    .catch(() => [undefined]);

  if (!settings) return;

  // Check ignored channels
  if (settings.ignoredChannelIds?.includes(message.channelId)) return;

  const mutedRoleId = settings.mutedRoleId;
  const logChannelId = settings.logChannelId;
  const bannedWords = settings.bannedWords ?? [];

  const content = message.content.toLowerCase();

  // Word filter
  const hitWord = bannedWords.find((w) => content.includes(w));
  if (hitWord) {
    try {
      await message.delete();
      const warn = await (message.channel as TextChannel).send(
        `${member} Your message was removed for containing a banned word.`,
      );
      setTimeout(() => warn.delete().catch(() => {}), 5000);
      if (logChannelId) {
        await postLog(logChannelId, new EmbedBuilder()
          .setColor(0xff4400).setTitle("Automod: Banned Word")
          .addFields(
            { name: "User", value: `${message.author.tag} (${message.author.id})`, inline: true },
            { name: "Word", value: `||${hitWord}||`, inline: true },
            { name: "Channel", value: `<#${message.channelId}>`, inline: true },
          ).setTimestamp(), message.client);
      }
    } catch (err) { logger.error({ err }, "automod word filter"); }
    return;
  }

  // Link filter — non-admins can't post links
  if (URL_REGEX.test(message.content)) {
    try {
      await message.delete();
      const warn = await (message.channel as TextChannel).send(
        `${member} You do not have permission to post links.`,
      );
      setTimeout(() => warn.delete().catch(() => {}), 5000);
    } catch (err) { logger.error({ err }, "automod link filter"); }
    return;
  }

  // Spam detection
  const guildKey = message.guild.id;
  if (!spamMap.has(guildKey)) spamMap.set(guildKey, new Map());
  const guildSpam = spamMap.get(guildKey)!;
  const now = Date.now();
  const times = (guildSpam.get(message.author.id) ?? []).filter(
    (t) => now - t < SPAM_WINDOW_MS,
  );
  times.push(now);
  guildSpam.set(message.author.id, times);

  if (times.length >= SPAM_THRESHOLD) {
    guildSpam.set(message.author.id, []);
    try {
      // Delete recent messages from spammer
      const msgs = await message.channel.messages.fetch({ limit: 10 });
      const spamMsgs = msgs.filter((m) => m.author.id === message.author.id);
      for (const m of spamMsgs.values()) await m.delete().catch(() => {});

      // Mute if role configured
      if (mutedRoleId) {
        await member.roles.add(mutedRoleId, "Automod: spam");
        setTimeout(async () => {
          try { await member.roles.remove(mutedRoleId!, "Automod mute expired"); } catch {}
        }, 5 * 60 * 1000); // 5 minutes
      }

      const warn = await (message.channel as TextChannel).send(
        `${member} has been muted for spamming.`,
      );
      setTimeout(() => warn.delete().catch(() => {}), 8000);

      if (logChannelId) {
        await postLog(logChannelId, new EmbedBuilder()
          .setColor(0xffaa00).setTitle("Automod: Spam Detected")
          .addFields(
            { name: "User", value: `${message.author.tag} (${message.author.id})`, inline: true },
            { name: "Channel", value: `<#${message.channelId}>`, inline: true },
            { name: "Action", value: mutedRoleId ? "Muted 5 minutes" : "Messages deleted", inline: true },
          ).setTimestamp(), message.client);
      }
    } catch (err) { logger.error({ err }, "automod spam handler"); }
  }
}
