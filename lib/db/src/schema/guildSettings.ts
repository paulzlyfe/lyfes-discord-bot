import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const guildSettingsTable = pgTable("guild_settings", {
  guildId: text("guild_id").primaryKey(),
  logChannelId: text("log_channel_id"),
  liveAlertChannelId: text("live_alert_channel_id"),
  streamerRoleId: text("streamer_role_id"),
  mutedRoleId: text("muted_role_id"),
  giveawayPingRoleId: text("giveaway_ping_role_id"),
  adminRoleIds: text("admin_role_ids").array().notNull().default([]),
  ignoredChannelIds: text("ignored_channel_ids").array().notNull().default([]),
  bannedWords: text("banned_words").array().notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type GuildSettings = typeof guildSettingsTable.$inferSelect;
