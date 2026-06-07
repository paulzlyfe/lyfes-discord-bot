import { DatabaseSync } from "node:sqlite";
import path from "path";
import fs from "fs";

const dbPath = path.join(process.cwd(), "artifacts", "discord-bot", "data", "bot.db");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new DatabaseSync(dbPath);

// Migrate existing databases to add new columns safely
try { db.exec(`ALTER TABLE guild_config ADD COLUMN member_log_channel_id TEXT`); } catch { /* already exists */ }

db.exec(`
  CREATE TABLE IF NOT EXISTS warnings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    moderator_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS mod_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    action TEXT NOT NULL,
    target_user_id TEXT NOT NULL,
    moderator_id TEXT NOT NULL,
    reason TEXT,
    extra TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS guild_config (
    guild_id TEXT PRIMARY KEY,
    log_channel_id TEXT,
    member_log_channel_id TEXT,
    automod_enabled INTEGER NOT NULL DEFAULT 1,
    banned_words TEXT NOT NULL DEFAULT '[]',
    spam_threshold INTEGER NOT NULL DEFAULT 5,
    spam_window_ms INTEGER NOT NULL DEFAULT 5000
  );

  CREATE TABLE IF NOT EXISTS streamer_links (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    url TEXT NOT NULL,
    PRIMARY KEY (guild_id, user_id)
  );
`);

export function getGuildConfig(guildId: string) {
  let row = db
    .prepare("SELECT * FROM guild_config WHERE guild_id = ?")
    .get(guildId) as any;
  if (!row) {
    db.prepare("INSERT OR IGNORE INTO guild_config (guild_id) VALUES (?)").run(guildId);
    row = db.prepare("SELECT * FROM guild_config WHERE guild_id = ?").get(guildId) as any;
  }
  return {
    ...row,
    banned_words: JSON.parse(row.banned_words || "[]") as string[],
    automod_enabled: Boolean(row.automod_enabled),
  };
}

export function setLogChannel(guildId: string, channelId: string) {
  db.prepare("UPDATE guild_config SET log_channel_id = ? WHERE guild_id = ?").run(channelId, guildId);
}

export function addWarning(guildId: string, userId: string, moderatorId: string, reason: string) {
  db.prepare(
    "INSERT INTO warnings (guild_id, user_id, moderator_id, reason) VALUES (?, ?, ?, ?)"
  ).run(guildId, userId, moderatorId, reason);
}

export function getWarnings(guildId: string, userId: string) {
  return db
    .prepare("SELECT * FROM warnings WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC")
    .all(guildId, userId) as Array<{
    id: number;
    moderator_id: string;
    reason: string;
    created_at: number;
  }>;
}

export function clearWarnings(guildId: string, userId: string) {
  db.prepare("DELETE FROM warnings WHERE guild_id = ? AND user_id = ?").run(guildId, userId);
}

export function logAction(
  guildId: string,
  action: string,
  targetUserId: string,
  moderatorId: string,
  reason?: string,
  extra?: string
) {
  db.prepare(
    "INSERT INTO mod_log (guild_id, action, target_user_id, moderator_id, reason, extra) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(guildId, action, targetUserId, moderatorId, reason ?? null, extra ?? null);
}

export function setMemberLogChannel(guildId: string, channelId: string) {
  db.prepare("UPDATE guild_config SET member_log_channel_id = ? WHERE guild_id = ?").run(channelId, guildId);
}

export function setBannedWords(guildId: string, words: string[]) {
  db.prepare("UPDATE guild_config SET banned_words = ? WHERE guild_id = ?").run(JSON.stringify(words), guildId);
}

export function setAutomod(guildId: string, enabled: boolean) {
  db.prepare("UPDATE guild_config SET automod_enabled = ? WHERE guild_id = ?").run(enabled ? 1 : 0, guildId);
}

export function setStreamerLink(guildId: string, userId: string, platform: "youtube" | "twitch", url: string) {
  db.prepare(
    "INSERT INTO streamer_links (guild_id, user_id, platform, url) VALUES (?, ?, ?, ?) ON CONFLICT(guild_id, user_id) DO UPDATE SET platform = excluded.platform, url = excluded.url"
  ).run(guildId, userId, platform, url);
}

export function getStreamerLink(guildId: string, userId: string) {
  return db
    .prepare("SELECT platform, url FROM streamer_links WHERE guild_id = ? AND user_id = ?")
    .get(guildId, userId) as { platform: "youtube" | "twitch"; url: string } | undefined;
}

export function getAllStreamerLinks() {
  return db
    .prepare("SELECT guild_id, user_id, platform, url FROM streamer_links")
    .all() as Array<{ guild_id: string; user_id: string; platform: "youtube" | "twitch"; url: string }>;
}

export function removeStreamerLink(guildId: string, userId: string) {
  db.prepare("DELETE FROM streamer_links WHERE guild_id = ? AND user_id = ?").run(guildId, userId);
}
