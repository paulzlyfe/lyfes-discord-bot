import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("❌ DATABASE_URL environment variable is not set.");
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  ssl: connectionString.includes("localhost") ? false : { rejectUnauthorized: false },
  idleTimeoutMillis: 30_000,
  max: 3,
});

export async function initDb(): Promise<void> {
  // Retry up to 20 times with exponential backoff (cap 30 s) — guards against transient
  // ECONNRESET / ETIMEDOUT on startup (e.g. after rapid restarts exhausted connection slots).
  const MAX_ATTEMPTS = 20;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await pool.query(`SELECT 1`); // connectivity check
      break;
    } catch (err) {
      lastErr = err;
      const wait = Math.min(attempt * 3000, 30_000);
      console.error(`[db] Connection attempt ${attempt}/${MAX_ATTEMPTS} failed — retrying in ${wait}ms:`, (err as Error).message);
      await new Promise((r) => setTimeout(r, wait));
      if (attempt === MAX_ATTEMPTS) throw lastErr;
    }
  }

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

    CREATE TABLE IF NOT EXISTS giveaway_config (
      guild_id TEXT PRIMARY KEY,
      channel_id TEXT,
      allowed_role_ids TEXT NOT NULL DEFAULT '[]',
      ping_role_id TEXT
    );

    -- Migration: add ping_role_id if this table already existed without it
    ALTER TABLE giveaway_config ADD COLUMN IF NOT EXISTS ping_role_id TEXT;

    CREATE TABLE IF NOT EXISTS giveaways (
      id SERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      prize TEXT NOT NULL,
      ends_at BIGINT NOT NULL,
      winner_count INTEGER NOT NULL DEFAULT 1,
      ended BOOLEAN NOT NULL DEFAULT FALSE,
      winners TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS reaction_role_config (
      guild_id TEXT PRIMARY KEY,
      channel_id TEXT
    );

    CREATE TABLE IF NOT EXISTS reaction_role_messages (
      id SERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_id TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reaction_role_mappings (
      id SERIAL PRIMARY KEY,
      message_id TEXT NOT NULL,
      emoji TEXT NOT NULL,
      role_id TEXT NOT NULL,
      UNIQUE (message_id, emoji)
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

// ─── Giveaway ─────────────────────────────────────────────────────────────────

export type GiveawayRow = {
  id: number;
  guild_id: string;
  channel_id: string;
  message_id: string;
  prize: string;
  ends_at: number;
  winner_count: number;
  ended: boolean;
  winners: string[];
};

export async function getGiveawayConfig(guildId: string) {
  await pool.query(
    "INSERT INTO giveaway_config (guild_id) VALUES ($1) ON CONFLICT DO NOTHING",
    [guildId]
  );
  const { rows } = await pool.query<{
    guild_id: string;
    channel_id: string | null;
    allowed_role_ids: string;
    ping_role_id: string | null;
  }>("SELECT * FROM giveaway_config WHERE guild_id = $1", [guildId]);
  return rows[0];
}

export async function setGiveawayChannel(guildId: string, channelId: string): Promise<void> {
  await pool.query(
    `INSERT INTO giveaway_config (guild_id, channel_id)
     VALUES ($1, $2)
     ON CONFLICT (guild_id) DO UPDATE SET channel_id = EXCLUDED.channel_id`,
    [guildId, channelId]
  );
}

export async function addGiveawayRole(guildId: string, roleId: string): Promise<void> {
  const config = await getGiveawayConfig(guildId);
  const current: string[] = JSON.parse(config.allowed_role_ids || "[]");
  if (!current.includes(roleId)) current.push(roleId);
  await pool.query(
    "UPDATE giveaway_config SET allowed_role_ids = $1 WHERE guild_id = $2",
    [JSON.stringify(current), guildId]
  );
}

export async function removeGiveawayRole(guildId: string, roleId: string): Promise<void> {
  const config = await getGiveawayConfig(guildId);
  const current: string[] = JSON.parse(config.allowed_role_ids || "[]");
  const updated = current.filter((id) => id !== roleId);
  await pool.query(
    "UPDATE giveaway_config SET allowed_role_ids = $1 WHERE guild_id = $2",
    [JSON.stringify(updated), guildId]
  );
}

export async function createGiveaway(
  guildId: string,
  channelId: string,
  messageId: string,
  prize: string,
  endsAt: number,
  winnerCount: number
): Promise<GiveawayRow> {
  const { rows } = await pool.query<{
    id: number;
    guild_id: string;
    channel_id: string;
    message_id: string;
    prize: string;
    ends_at: string;
    winner_count: number;
    ended: boolean;
    winners: string;
  }>(
    `INSERT INTO giveaways (guild_id, channel_id, message_id, prize, ends_at, winner_count)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [guildId, channelId, messageId, prize, endsAt, winnerCount]
  );
  const r = rows[0];
  return { ...r, ends_at: Number(r.ends_at), winners: JSON.parse(r.winners || "[]") };
}

export async function markGiveawayEnded(id: number, winnerIds: string[]): Promise<void> {
  await pool.query(
    "UPDATE giveaways SET ended = TRUE, winners = $1 WHERE id = $2",
    [JSON.stringify(winnerIds), id]
  );
}

export async function getPendingGiveaways(): Promise<GiveawayRow[]> {
  const { rows } = await pool.query<{
    id: number;
    guild_id: string;
    channel_id: string;
    message_id: string;
    prize: string;
    ends_at: string;
    winner_count: number;
    ended: boolean;
    winners: string;
  }>("SELECT * FROM giveaways WHERE ended = FALSE");
  return rows.map((r) => ({
    ...r,
    ends_at: Number(r.ends_at),
    winners: JSON.parse(r.winners || "[]"),
  }));
}

export async function setGiveawayPingRole(guildId: string, roleId: string | null): Promise<void> {
  await pool.query(
    `INSERT INTO giveaway_config (guild_id, ping_role_id)
     VALUES ($1, $2)
     ON CONFLICT (guild_id) DO UPDATE SET ping_role_id = EXCLUDED.ping_role_id`,
    [guildId, roleId]
  );
}

// ─── Reaction roles ───────────────────────────────────────────────────────────

export async function getReactionRoleConfig(guildId: string) {
  await pool.query(
    "INSERT INTO reaction_role_config (guild_id) VALUES ($1) ON CONFLICT DO NOTHING",
    [guildId]
  );
  const { rows } = await pool.query<{ guild_id: string; channel_id: string | null }>(
    "SELECT * FROM reaction_role_config WHERE guild_id = $1",
    [guildId]
  );
  return rows[0];
}

export async function setReactionRoleChannel(guildId: string, channelId: string): Promise<void> {
  await pool.query(
    `INSERT INTO reaction_role_config (guild_id, channel_id)
     VALUES ($1, $2)
     ON CONFLICT (guild_id) DO UPDATE SET channel_id = EXCLUDED.channel_id`,
    [guildId, channelId]
  );
}

export async function createReactionRoleMessage(
  guildId: string,
  channelId: string,
  messageId: string,
  label: string
): Promise<void> {
  await pool.query(
    "INSERT INTO reaction_role_messages (guild_id, channel_id, message_id, label) VALUES ($1, $2, $3, $4)",
    [guildId, channelId, messageId, label]
  );
}

export async function addReactionRoleMapping(
  messageId: string,
  emoji: string,
  roleId: string
): Promise<void> {
  await pool.query(
    `INSERT INTO reaction_role_mappings (message_id, emoji, role_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (message_id, emoji) DO UPDATE SET role_id = EXCLUDED.role_id`,
    [messageId, emoji, roleId]
  );
}

export async function getReactionRoleMappings(
  messageId: string
): Promise<{ emoji: string; role_id: string }[]> {
  const { rows } = await pool.query<{ emoji: string; role_id: string }>(
    "SELECT emoji, role_id FROM reaction_role_mappings WHERE message_id = $1",
    [messageId]
  );
  return rows;
}

export async function isReactionRoleMessage(messageId: string): Promise<boolean> {
  const { rows } = await pool.query<{ message_id: string }>(
    "SELECT message_id FROM reaction_role_messages WHERE message_id = $1 LIMIT 1",
    [messageId]
  );
  return rows.length > 0;
}
