import { Message } from "discord.js";
import { getGuildConfig, logAction } from "./db.js";

const spamTracker = new Map<string, { count: number; firstMessageAt: number }>();

export async function runAutomod(message: Message) {
  if (!message.guild || message.author.bot) return;

  const config = getGuildConfig(message.guild.id);
  if (!config.automod_enabled) return;

  const key = `${message.guild.id}:${message.author.id}`;
  const now = Date.now();

  // Spam detection
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
        logAction(
          message.guild.id,
          "AUTOMOD_TIMEOUT",
          message.author.id,
          message.client.user!.id,
          "Spam detected",
          `${tracker.count} messages in ${config.spam_window_ms}ms`
        );
        await message.reply(
          `${message.author}, you've been muted for 1 minute for spamming.`
        ).catch(() => {});
      } catch {}
      return;
    }
  }

  // Banned words detection
  const content = message.content.toLowerCase();
  const hit = config.banned_words.find((w: string) => content.includes(w.toLowerCase()));
  if (hit) {
    try {
      await message.delete();
      logAction(
        message.guild.id,
        "AUTOMOD_DELETE",
        message.author.id,
        message.client.user!.id,
        `Banned word: ${hit}`
      );
      const warn = await message.channel
        .send(`${message.author}, your message was removed for containing a banned word.`)
        .catch(() => null);
      if (warn) setTimeout(() => warn.delete().catch(() => {}), 5000);
    } catch {}
  }
}
