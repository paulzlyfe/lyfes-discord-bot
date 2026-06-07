import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("❌ DATABASE_URL environment variable is not set.");
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  ssl: connectionString.includes("localhost") ? false : { rejectUnauthorized: false },
});

export async function initDb(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS guild_config (
      guild_id TEXT PRIMARY KEY,
      log_channel_id TEXT,
      member_log_channel_id TEXT,
      automod_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      banned_words TEXT NOT NULL DEFAULT '[]',
      spam_threshold INTEGER NOT NULL DEFAULT 5,
      spam_window_ms INTEGER NOT NULL DEFAULT 5000
    );

    CREATE TABLE IF NOT EXISTS warnings (
      id SERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      moderator_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
    );

    CREATE TABLE IF NOT EXISTS mod_log (
      id SERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      action TEXT NOT NULL,
      target_user_id TEXT NOT NULL,
      moderator_id TEXT NOT NULL,
      reason TEXT,
      extra TEXT,
      created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
    );

    CREATE TABLE IF NOT EXISTS streamer_links (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      url TEXT NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    );
  `);
}

export async function getGuildConfig(guildId: string) {
  await pool.query(
    "INSERT INTO guild_config (guild_id) VALUES ($1) ON CONFLICT DO NOTHING",
    [guildId]
  );
  const { rows } = await pool.query<{
    guild_id: string;
    log_channel_id: string | null;
    member_log_channel_id: string | null;
    automod_enabled: boolean;
    banned_words: string;
    spam_threshold: number;
    spam_window_ms: number;
  }>("SELECT * FROM guild_config WHERE guild_id = $1", [guildId]);
  const row = rows[0];
  return {
    ...row,
    banned_words: JSON.parse(row.banned_words || "[]") as string[],
    automod_enabled: Boolean(row.automod_enabled),
  };
}

export async function setLogChannel(guildId: string, channelId: string): Promise<void> {
  await pool.query(
    "UPDATE guild_config SET log_channel_id = $1 WHERE guild_id = $2",
    [channelId, guildId]
  );
}

export async function setMemberLogChannel(guildId: string, channelId: string): Promise<void> {
  await pool.query(
    "UPDATE guild_config SET member_log_channel_id = $1 WHERE guild_id = $2",
    [channelId, guildId]
  );
}

export async function setBannedWords(guildId: string, words: string[]): Promise<void> {
  await pool.query(
    "UPDATE guild_config SET banned_words = $1 WHERE guild_id = $2",
    [JSON.stringify(words), guildId]
  );
}

export async function setAutomod(guildId: string, enabled: boolean): Promise<void> {
  await pool.query(
    "UPDATE guild_config SET automod_enabled = $1 WHERE guild_id = $2",
    [enabled, guildId]
  );
}

export async function addWarning(guildId: string, userId: string, moderatorId: string, reason: string): Promise<void> {
  await pool.query(
    "INSERT INTO warnings (guild_id, user_id, moderator_id, reason) VALUES ($1, $2, $3, $4)",
    [guildId, userId, moderatorId, reason]
  );
}

export async function getWarnings(guildId: string, userId: string) {
  const { rows } = await pool.query<{
    id: number;
    moderator_id: string;
    reason: string;
    created_at: string;
  }>(
    "SELECT * FROM warnings WHERE guild_id = $1 AND user_id = $2 ORDER BY created_at DESC",
    [guildId, userId]
  );
  return rows.map((r) => ({ ...r, created_at: Number(r.created_at) }));
}

export async function clearWarnings(guildId: string, userId: string): Promise<void> {
  await pool.query(
    "DELETE FROM warnings WHERE guild_id = $1 AND user_id = $2",
    [guildId, userId]
  );
}

export async function logAction(
  guildId: string,
  action: string,
  targetUserId: string,
  moderatorId: string,
  reason?: string,
  extra?: string
): Promise<void> {
  await pool.query(
    "INSERT INTO mod_log (guild_id, action, target_user_id, moderator_id, reason, extra) VALUES ($1, $2, $3, $4, $5, $6)",
    [guildId, action, targetUserId, moderatorId, reason ?? null, extra ?? null]
  );
}

export async function setStreamerLink(
  guildId: string,
  userId: string,
  platform: "youtube" | "twitch",
  url: string
): Promise<void> {
  await pool.query(
    `INSERT INTO streamer_links (guild_id, user_id, platform, url)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (guild_id, user_id) DO UPDATE SET platform = EXCLUDED.platform, url = EXCLUDED.url`,
    [guildId, userId, platform, url]
  );
}

export async function getStreamerLink(guildId: string, userId: string) {
  const { rows } = await pool.query<{ platform: "youtube" | "twitch"; url: string }>(
    "SELECT platform, url FROM streamer_links WHERE guild_id = $1 AND user_id = $2",
    [guildId, userId]
  );
  return rows[0] as { platform: "youtube" | "twitch"; url: string } | undefined;
}

export async function getAllStreamerLinks() {
  const { rows } = await pool.query<{
    guild_id: string;
    user_id: string;
    platform: "youtube" | "twitch";
    url: string;
  }>("SELECT guild_id, user_id, platform, url FROM streamer_links");
  return rows;
}

export async function removeStreamerLink(guildId: string, userId: string): Promise<void> {
  await pool.query(
    "DELETE FROM streamer_links WHERE guild_id = $1 AND user_id = $2",
    [guildId, userId]
  );
}
