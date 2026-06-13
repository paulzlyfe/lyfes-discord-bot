import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  GuildMember,
  MessageReaction,
  PartialMessageReaction,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextChannel,
  User,
  PartialUser,
} from "discord.js";
import {
  getReactionRoleConfig,
  setReactionRoleChannel,
  createReactionRoleMessage,
  addReactionRoleMapping,
  getReactionRoleMappings,
  isReactionRoleMessage,
} from "../db.js";

// ─── Emoji normaliser ─────────────────────────────────────────────────────────
// Converts user input like <:name:123> or <a:name:123> to "name:123".
// Plain Unicode emoji are returned as-is.
export function normalizeEmoji(raw: string): string {
  const m = raw.trim().match(/^<a?:([^:]+):(\d+)>$/);
  return m ? `${m[1]}:${m[2]}` : raw.trim();
}

// ─── Command builders ─────────────────────────────────────────────────────────
export const reactionRolesCommand = new SlashCommandBuilder()
  .setName("reactionroles")
  .setDescription("Configure the reaction roles channel")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((sub) =>
    sub
      .setName("setchannel")
      .setDescription("Set the channel where reaction role messages are posted")
      .addChannelOption((o) =>
        o.setName("channel").setDescription("Reaction roles channel").setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub.setName("list").setDescription("Show current reaction roles channel")
  );

export const setReactionRoleCommand = (() => {
  const cmd = new SlashCommandBuilder()
    .setName("setreactionrole")
    .setDescription("Post a reaction role message with up to 5 emoji → role mappings")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((o) =>
      o
        .setName("text")
        .setDescription("The title/description shown on the reaction role message")
        .setRequired(true)
    );

  // Required first pair
  cmd
    .addStringOption((o) =>
      o.setName("emoji1").setDescription("First emoji (e.g. 🔴 or <:custom:id>)").setRequired(true)
    )
    .addRoleOption((o) =>
      o.setName("role1").setDescription("Role given for emoji1").setRequired(true)
    );

  // Optional pairs 2–5
  for (let i = 2; i <= 5; i++) {
    cmd
      .addStringOption((o) =>
        o
          .setName(`emoji${i}`)
          .setDescription(`Emoji ${i} (optional)`)
      )
      .addRoleOption((o) =>
        o.setName(`role${i}`).setDescription(`Role for emoji${i} (optional)`)
      );
  }

  return cmd;
})();

// ─── Reaction role event handlers ─────────────────────────────────────────────

async function resolveReaction(
  reaction: MessageReaction | PartialMessageReaction
): Promise<MessageReaction | null> {
  if (reaction.partial) {
    try {
      return await reaction.fetch();
    } catch {
      return null;
    }
  }
  return reaction;
}

export async function handleReactionAdd(
  rawReaction: MessageReaction | PartialMessageReaction,
  rawUser: User | PartialUser
): Promise<void> {
  if (rawUser.bot) return;

  const reaction = await resolveReaction(rawReaction);
  if (!reaction) return;

  const { message } = reaction;
  if (!message.guild) return;
  if (!(await isReactionRoleMessage(message.id).catch(() => false))) return;

  const emojiKey = reaction.emoji.id
    ? `${reaction.emoji.name}:${reaction.emoji.id}`
    : (reaction.emoji.name ?? "");

  const mappings = await getReactionRoleMappings(message.id).catch(() => []);
  const entry = mappings.find((m) => m.emoji === emojiKey);
  if (!entry) return;

  try {
    const member = await message.guild.members.fetch(rawUser.id);
    await member.roles.add(entry.role_id, "Reaction role");
  } catch {
    // Missing permission or member left — ignore
  }
}

export async function handleReactionRemove(
  rawReaction: MessageReaction | PartialMessageReaction,
  rawUser: User | PartialUser
): Promise<void> {
  if (rawUser.bot) return;

  const reaction = await resolveReaction(rawReaction);
  if (!reaction) return;

  const { message } = reaction;
  if (!message.guild) return;
  if (!(await isReactionRoleMessage(message.id).catch(() => false))) return;

  const emojiKey = reaction.emoji.id
    ? `${reaction.emoji.name}:${reaction.emoji.id}`
    : (reaction.emoji.name ?? "");

  const mappings = await getReactionRoleMappings(message.id).catch(() => []);
  const entry = mappings.find((m) => m.emoji === emojiKey);
  if (!entry) return;

  try {
    const member = await message.guild.members.fetch(rawUser.id);
    await member.roles.remove(entry.role_id, "Reaction role removed");
  } catch {
    // Missing permission or member left — ignore
  }
}

// ─── Command handler ──────────────────────────────────────────────────────────
export async function handleReactionRoleCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ content: "Must be used in a server.", flags: 64 });
    return;
  }

  const guildId = interaction.guild.id;
  const cmd = interaction.commandName;

  try {
    // ── /reactionroles ───────────────────────────────────────────────────────
    if (cmd === "reactionroles") {
      const sub = interaction.options.getSubcommand();

      if (sub === "setchannel") {
        const ch = interaction.options.getChannel("channel", true);
        await setReactionRoleChannel(guildId, ch.id);
        await interaction.reply({
          content: `✅ Reaction roles channel set to <#${ch.id}>.`,
          flags: 64,
        });

      } else if (sub === "list") {
        const config = await getReactionRoleConfig(guildId);
        await interaction.reply({
          content: config.channel_id
            ? `📋 Reaction roles channel: <#${config.channel_id}>`
            : "No reaction roles channel set. Use `/reactionroles setchannel` first.",
          flags: 64,
        });
      }

    // ── /setreactionrole ─────────────────────────────────────────────────────
    } else if (cmd === "setreactionrole") {
      const config = await getReactionRoleConfig(guildId);
      if (!config.channel_id) {
        await interaction.reply({
          content:
            "❌ No reaction roles channel configured. Run `/reactionroles setchannel` first.",
          flags: 64,
        });
        return;
      }

      const targetCh = (await interaction.client.channels
        .fetch(config.channel_id)
        .catch(() => null)) as TextChannel | null;
      if (!targetCh) {
        await interaction.reply({
          content: "❌ The configured reaction roles channel no longer exists. Please set a new one.",
          flags: 64,
        });
        return;
      }

      const text = interaction.options.getString("text", true);

      // Collect emoji/role pairs (1 required + up to 4 optional)
      const pairs: { emoji: string; roleId: string; roleName: string }[] = [];
      for (let i = 1; i <= 5; i++) {
        const emojiRaw = interaction.options.getString(`emoji${i}`);
        const role = interaction.options.getRole(`role${i}`);
        if (!emojiRaw || !role) continue;
        pairs.push({
          emoji: normalizeEmoji(emojiRaw),
          roleId: role.id,
          roleName: role.name,
        });
      }

      if (pairs.length === 0) {
        await interaction.reply({
          content: "❌ You must provide at least one emoji and role.",
          flags: 64,
        });
        return;
      }

      // Build the embed displayed in the channel
      const lines = pairs
        .map((p) => {
          // Display emoji: unicode as-is, custom as <:name:id>
          const display = p.emoji.includes(":") ? `<:${p.emoji}>` : p.emoji;
          return `${display} → <@&${p.roleId}>`;
        })
        .join("\n");

      const embed = new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle(`📋 ${text}`)
        .setDescription(`React with an emoji below to receive the corresponding role.\n\n${lines}`)
        .setFooter({ text: "React to add a role • Remove reaction to remove the role" });

      await interaction.deferReply({ flags: 64 });

      const posted = await targetCh.send({ embeds: [embed] });

      // React with each emoji so they appear as clickable reactions
      for (const p of pairs) {
        const reactionTarget = p.emoji.includes(":")
          ? interaction.guild!.emojis.cache.get(p.emoji.split(":")[1]) ?? p.emoji
          : p.emoji;
        await posted.react(reactionTarget).catch(() => {
          // Custom emoji might not be in cache — try string directly
          posted.react(p.emoji).catch(() => {});
        });
      }

      // Persist to DB
      await createReactionRoleMessage(guildId, config.channel_id, posted.id, text);
      for (const p of pairs) {
        await addReactionRoleMapping(posted.id, p.emoji, p.roleId);
      }

      await interaction.editReply({
        content: `✅ Reaction role message posted in <#${config.channel_id}> with ${pairs.length} role${pairs.length !== 1 ? "s" : ""}.`,
      });
    }
  } catch (err: any) {
    const msg = `❌ Error: ${err.message}`;
    if (interaction.replied || interaction.deferred) {
      await interaction.editReply({ content: msg }).catch(() => {});
    } else {
      await interaction.reply({ content: msg, flags: 64 }).catch(() => {});
    }
  }
}
