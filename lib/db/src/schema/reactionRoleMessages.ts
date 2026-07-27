import { pgTable, text, timestamp, serial, jsonb } from "drizzle-orm/pg-core";

export interface EmojiRolePair {
  emoji: string;
  roleId: string;
  roleName: string;
}

export const reactionRoleMessagesTable = pgTable("reaction_role_messages", {
  id: serial("id").primaryKey(),
  messageId: text("message_id").notNull().unique(),
  channelId: text("channel_id").notNull(),
  guildId: text("guild_id").notNull(),
  title: text("title").notNull(),
  emojiRolePairs: jsonb("emoji_role_pairs")
    .notNull()
    .$type<EmojiRolePair[]>()
    .default([]),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type ReactionRoleMessage =
  typeof reactionRoleMessagesTable.$inferSelect;
