import {
  ChatInputCommandInteraction,
  EmbedBuilder,
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

// ─── Emoji helpers ────────────────────────────────────────────────────────────
// Normalise emoji input from a slash command string option.
// Unicode emoji  → returned as-is            (e.g. "🔴")
// Static custom  → "<:name:id>"  → "name:id"
// Animated custom→ "<a:name:id>" → "a:name:id"
export function normalizeEmoji(raw: string): string {
  const m = raw.trim().match(/^<(a?):([^:]+):(\d+)>$/);
  if (m) return `${m[1] ? "a:" : ""}${m[2]}:${m[3]}`;
  return raw.trim();
}

// Convert stored emoji key back to a string Discord's react() / embed can use.
// "a:name:id" → "<a:name:id>"   (animated)
// "name:id"   → "<:name:id>"    (static custom)
// "🔴"        → "🔴"            (unicode)
function emojiToDisplay(stored: string): string {
  if (stored.startsWith("a:")) return `<a:${stored.slice(2)}>`;
  if (stored.includes(":")) return `<:${stored}>`;
  return stored;
}

// Match a stored mapping key against an incoming reaction.
// Custom emoji are matched by ID (rename-proof — a renamed emoji keeps its ID),
// unicode emoji are matched by their character.
function emojiMatches(
  stored: string,
  emoji: { id: string | null; name: string | null }
): boolean {
  if (emoji.id) {
    // stored is "name:id" or "a:name:id" → compare the trailing id segment
    return stored.split(":").pop() === emoji.id;
  }
  return stored === (emoji.name ?? "");
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
    .setDescription("Post a reaction role message with up to 5 emoji → role mappings (admin only)")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((o) =>
      o
        .setName("text")
        .setDescription("Title shown on the reaction role message")
        .setRequired(true)
    );

  // Required first pair
  cmd
    .addStringOption((o) =>
      o
        .setName("emoji1")
        .setDescription("First emoji — standard (🔴) or custom server emoji (<:name:id>)")
        .setRequired(true)
    )
    .addRoleOption((o) =>
      o.setName("role1").setDescription("Role given when reacting with emoji1").setRequired(true)
    );

  // Optional pairs 2–5
  for (let i = 2; i <= 5; i++) {
    cmd
      .addStringOption((o) =>
        o
          .setName(`emoji${i}`)
          .setDescription(`Emoji ${i} — standard or custom server emoji (optional)`)
      )
      .addRoleOption((o) =>
        o.setName(`role${i}`).setDescription(`Role for emoji${i} (optional)`)
      );
  }

  return cmd;
})();

// ─── Reaction event handlers ──────────────────────────────────────────────────
async function resolveReaction(
  reaction: MessageReaction | PartialMessageReaction
): Promise<MessageReaction | null> {
  if (reaction.partial) {
    try { return await reaction.fetch(); } catch { return null; }
  }
  return reaction;
}

export async function handleReactionAdd(
  rawReaction: MessageReaction | PartialMessageReaction,
  rawUser: User | PartialUser
): Promise<void> {
  if (rawUser.bot) return;

  const reaction = await resolveReaction(rawReaction);
  if (!reaction || !reaction.message.guild) return;

  if (!(await isReactionRoleMessage(reaction.message.id).catch(() => false))) return;

  const mappings = await getReactionRoleMappings(reaction.message.id)
    .catch((): { emoji: string; role_id: string }[] => []);
  const entry = mappings.find((m) => emojiMatches(m.emoji, reaction.emoji));
  if (!entry) return;

  try {
    const member = await reaction.message.guild.members.fetch(rawUser.id);
    await member.roles.add(entry.role_id, "Reaction role");
  } catch { /* missing permission or member left */ }
}

export async function handleReactionRemove(
  rawReaction: MessageReaction | PartialMessageReaction,
  rawUser: User | PartialUser
): Promise<void> {
  if (rawUser.bot) return;

  const reaction = await resolveReaction(rawReaction);
  if (!reaction || !reaction.message.guild) return;

  if (!(await isReactionRoleMessage(reaction.message.id).catch(() => false))) return;

  const mappings = await getReactionRoleMappings(reaction.message.id)
    .catch((): { emoji: string; role_id: string }[] => []);
  const entry = mappings.find((m) => emojiMatches(m.emoji, reaction.emoji));
  if (!entry) return;

  try {
    const member = await reaction.message.guild.members.fetch(rawUser.id);
    await member.roles.remove(entry.role_id, "Reaction role removed");
  } catch { /* missing permission or member left */ }
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

    } else if (cmd === "setreactionrole") {
      const config = await getReactionRoleConfig(guildId);
      if (!config.channel_id) {
        await interaction.reply({
          content: "❌ No reaction roles channel configured. Run `/reactionroles setchannel` first.",
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

      // Collect emoji/role pairs
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

      // Build embed
      const lines = pairs
        .map((p) => `${emojiToDisplay(p.emoji)} → <@&${p.roleId}>`)
        .join("\n");

      const embed = new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle(`📋 ${text}`)
        .setDescription(
          `React with an emoji below to receive the corresponding role.\n\n${lines}`
        )
        .setFooter({ text: "React to add a role • Remove reaction to remove the role" });

      await interaction.deferReply({ flags: 64 });

      const posted = await targetCh.send({ embeds: [embed] });

      // React with each emoji — converts stored key back to the format react() expects
      for (const p of pairs) {
        await posted.react(emojiToDisplay(p.emoji)).catch(() => {
          // fallback: pass the raw stored value directly
          return posted.react(p.emoji).catch(() => {});
        });
      }

      // Persist
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
