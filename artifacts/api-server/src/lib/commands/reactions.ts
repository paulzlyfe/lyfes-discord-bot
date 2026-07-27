import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  type ChatInputCommandInteraction,
  type TextChannel,
  type MessageReaction,
  type User,
  type GuildMember,
} from "discord.js";
import { db } from "@workspace/db";
import { reactionRoleMessagesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../logger";

export const reactionCommands = [
  new SlashCommandBuilder()
    .setName("reactionroles")
    .setDescription("Create a reaction role message (up to 5 emoji-role pairs)")
    .addStringOption((o) =>
      o.setName("title").setDescription("Title for the message").setRequired(true),
    )
    .addStringOption((o) =>
      o.setName("emoji1").setDescription("First emoji").setRequired(true),
    )
    .addRoleOption((o) =>
      o.setName("role1").setDescription("Role for first emoji").setRequired(true),
    )
    .addStringOption((o) =>
      o.setName("emoji2").setDescription("Second emoji").setRequired(false),
    )
    .addRoleOption((o) =>
      o.setName("role2").setDescription("Role for second emoji").setRequired(false),
    )
    .addStringOption((o) =>
      o.setName("emoji3").setDescription("Third emoji").setRequired(false),
    )
    .addRoleOption((o) =>
      o.setName("role3").setDescription("Role for third emoji").setRequired(false),
    )
    .addStringOption((o) =>
      o.setName("emoji4").setDescription("Fourth emoji").setRequired(false),
    )
    .addRoleOption((o) =>
      o.setName("role4").setDescription("Role for fourth emoji").setRequired(false),
    )
    .addStringOption((o) =>
      o.setName("emoji5").setDescription("Fifth emoji").setRequired(false),
    )
    .addRoleOption((o) =>
      o.setName("role5").setDescription("Role for fifth emoji").setRequired(false),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),
];

export async function handleReactions(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (interaction.commandName !== "reactionroles") return;

  const title = interaction.options.getString("title", true);
  const pairs: Array<{ emoji: string; roleId: string; roleName: string }> = [];

  for (let i = 1; i <= 5; i++) {
    const emoji = interaction.options.getString(`emoji${i}`);
    const role = interaction.options.getRole(`role${i}`);
    if (emoji && role) {
      pairs.push({ emoji, roleId: role.id, roleName: role.name });
    }
  }

  if (pairs.length === 0) {
    await interaction.reply({ content: "You must provide at least one emoji-role pair.", ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const description = pairs.map((p) => `${p.emoji} → **${p.roleName}**`).join("\n");
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: "React to get a role • React again to remove it" });

  const ch = interaction.channel as TextChannel;
  const msg = await ch.send({ embeds: [embed] });

  for (const pair of pairs) {
    try { await msg.react(pair.emoji); } catch {}
  }

  await db.insert(reactionRoleMessagesTable).values({
    messageId: msg.id,
    channelId: interaction.channelId,
    guildId: interaction.guild!.id,
    title,
    emojiRolePairs: pairs,
  }).onConflictDoUpdate({
    target: reactionRoleMessagesTable.messageId,
    set: { emojiRolePairs: pairs, title },
  });

  await interaction.editReply({ content: "✅ Reaction role message created!" });
}

export async function handleReactionRoleEvent(
  reaction: MessageReaction,
  user: User,
  add: boolean,
): Promise<void> {
  if (user.bot) return;
  const [rrMsg] = await db
    .select()
    .from(reactionRoleMessagesTable)
    .where(eq(reactionRoleMessagesTable.messageId, reaction.message.id));
  if (!rrMsg) return;

  const pair = rrMsg.emojiRolePairs.find(
    (p) => p.emoji === reaction.emoji.name || p.emoji === reaction.emoji.toString(),
  );
  if (!pair) return;

  try {
    const guild = reaction.message.guild!;
    const member = await guild.members.fetch(user.id) as GuildMember;
    if (add) {
      await member.roles.add(pair.roleId);
    } else {
      await member.roles.remove(pair.roleId);
    }
  } catch (err) {
    logger.error({ err, pair }, "Failed to assign reaction role");
  }
}
