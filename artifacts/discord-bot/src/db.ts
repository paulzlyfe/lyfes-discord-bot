import { DatabaseSync } from "node:sqlite";
import path from "path";
import fs from "fs";

const dbPath = path.join(process.cwd(), "artifacts", "discord-bot", "data", "bot.db");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new DatabaseSync(dbPath);

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
    automod_enabled INTEGER NOT NULL DEFAULT 1,
    banned_words TEXT NOT NULL DEFAULT '[]',
    spam_threshold INTEGER NOT NULL DEFAULT 5,
    spam_window_ms INTEGER NOT NULL DEFAULT 5000
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

export function setBannedWords(guildId: string, words: string[]) {
  db.prepare("UPDATE guild_config SET banned_words = ? WHERE guild_id = ?").run(JSON.stringify(words), guildId);
}

export function setAutomod(guildId: string, enabled: boolean) {
  db.prepare("UPDATE guild_config SET automod_enabled = ? WHERE guild_id = ?").run(enabled ? 1 : 0, guildId);
}
