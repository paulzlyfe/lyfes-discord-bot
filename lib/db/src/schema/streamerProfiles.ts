import { pgTable, text, timestamp, primaryKey } from "drizzle-orm/pg-core";

export const streamerProfilesTable = pgTable(
  "streamer_profiles",
  {
    userId: text("user_id").notNull(),
    guildId: text("guild_id").notNull(),
    platform: text("platform").notNull(), // 'twitch' | 'youtube'
    channelUrl: text("channel_url").notNull(),
    channelIdentifier: text("channel_identifier").notNull(),
    isLive: text("is_live").notNull().default("false"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [primaryKey({ columns: [t.userId, t.guildId] })],
);

export type StreamerProfile = typeof streamerProfilesTable.$inferSelect;
