import { pgTable, text, timestamp, serial, integer } from "drizzle-orm/pg-core";

export const giveawaysTable = pgTable("giveaways", {
  id: serial("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  channelId: text("channel_id").notNull(),
  messageId: text("message_id"),
  prize: text("prize").notNull(),
  winnerCount: integer("winner_count").notNull().default(1),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  ended: text("ended").notNull().default("false"),
  entries: text("entries").array().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Giveaway = typeof giveawaysTable.$inferSelect;
