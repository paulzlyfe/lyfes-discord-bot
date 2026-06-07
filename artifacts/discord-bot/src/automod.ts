import { Message } from "discord.js";
import { addWarning, getGuildConfig, logAction } from "./db.js";

const LUCKY_ONES_ROLE_ID = "1506445605981913199";

const DISCORD_INVITE_RE = /discord(?:\.gg|(?:app)?\.com\/invite)\/[a-zA-Z0-9-]+/i;
const URL_RE = /(?:https?:\/\/|www\.)\S+/i;

const spamTracker = new Map<string, { count: number; firstMessageAt: number }>();

async function deleteAndWarn(
  message: Message,
  reason: string,
  userNotice: string,
  action: string
) {
  try {
    await message.delete();
  } catch {}

  await addWarning(
    message.guild!.id,
    message.author.id,
    message.client.user!.id,
    reason
  );
  await logAction(
    message.guild!.id,
    action,
    message.author.id,
    message.client.user!.id,
    reason
  );

  const notice = await message.channel
    .send(`${message.author}, ${userNotice}`)
    .catch(() => null);
  if (notice) setTimeout(() => notice.delete().catch(() => {}), 6000);
}

export async function runAutomod(message: Message) {
  if (!message.guild || message.author.bot) return;

  const config = await getGuildConfig(message.guild.id);
  if (!config.automod_enabled) return;

  // Lucky Ones role is exempt from all automod
  const member = message.member;
  if (member?.roles.cache.has(LUCKY_ONES_ROLE_ID)) return;

  const content = message.content;
  const contentLower = content.toLowerCase();
  const key = `${message.guild.id}:${message.author.id}`;
  const now = Date.now();

  // ── Discord invite link detection ──────────────────────────────────────
  if (DISCORD_INVITE_RE.test(content)) {
    await deleteAndWarn(
      message,
      "Posted a Discord invite link",
      "posting Discord server invites is not allowed here. **Warning issued.**",
      "AUTOMOD_INVITE"
    );
    return;
  }

  // ── General link detection ─────────────────────────────────────────────
  if (URL_RE.test(content)) {
    await deleteAndWarn(
      message,
      "Posted a link",
      "posting links is not allowed here. **Warning issued.**",
      "AUTOMOD_LINK"
    );
    return;
  }

  // ── Banned word detection ──────────────────────────────────────────────
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

  // ── Spam detection ─────────────────────────────────────────────────────
  const tracker = spamTracker.get(key) ?? { count: 0, firstMessageAt: now };
  if (now - tracker.firstMessageAt > config.spam_window_ms) {
    spamTracker.set(key, { count: 1, firstMessageAt: now });
  } else {
    tracker.count++;
    spamTracker.set(key, tracker);
    if (tracker.count >= config.spam_threshold) {
      spamTracker.delete(key);
      try {
        await member?.timeout(60_000, "AutoMod: Spam detected");
        await logAction(
          message.guild.id,
          "AUTOMOD_TIMEOUT",
          message.author.id,
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
