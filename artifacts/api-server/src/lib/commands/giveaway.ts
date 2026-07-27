import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  type ChatInputCommandInteraction,
  type TextChannel,
} from "discord.js";
import { db } from "@workspace/db";
import { guildSettingsTable, giveawaysTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "../logger";

export const giveawayCommands = [
  new SlashCommandBuilder()
    .setName("giveaway")
    .setDescription("Manage giveaways")
    .addSubcommand((sub) =>
      sub
        .setName("start")
        .setDescription("Start a new giveaway")
        .addStringOption((o) =>
          o.setName("prize").setDescription("What is being given away").setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName("duration")
            .setDescription("Duration, e.g. 10m, 1h, 2d")
            .setRequired(true),
        )
        .addIntegerOption((o) =>
          o
            .setName("winners")
            .setDescription("Number of winners")
            .setMinValue(1)
            .setMaxValue(10)
            .setRequired(false),
        )
        .addRoleOption((o) =>
          o
            .setName("ping-role")
            .setDescription("Role to ping when this giveaway starts (overrides server default)")
            .setRequired(false),
        ),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),

  new SlashCommandBuilder()
    .setName("setgiveaway")
    .setDescription("Set the role pinged when a giveaway starts")
    .addRoleOption((o) =>
      o.setName("role").setDescription("Role to ping").setRequired(true),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),
];

function parseDuration(input: string): number | null {
  const match = /^(\d+)(s|m|h|d)$/.exec(input.toLowerCase());
  if (!match) return null;
  const val = parseInt(match[1]!);
  const multipliers: Record<string, number> = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return val * (multipliers[match[2]!] ?? 0);
}

export async function endGiveaway(
  giveawayId: number,
  client: import("discord.js").Client,
): Promise<void> {
  const [giveaway] = await db
    .select()
    .from(giveawaysTable)
    .where(and(eq(giveawaysTable.id, giveawayId), eq(giveawaysTable.ended, "false")));

  if (!giveaway) return;

  await db
    .update(giveawaysTable)
    .set({ ended: "true" })
    .where(eq(giveawaysTable.id, giveawayId));

  const entries = giveaway.entries ?? [];
  const winnerCount = Math.min(giveaway.winnerCount, entries.length);
  const shuffled = [...entries].sort(() => Math.random() - 0.5);
  const winners = shuffled.slice(0, winnerCount);

  try {
    const ch = await client.channels.fetch(giveaway.channelId) as TextChannel;

    const embed = new EmbedBuilder()
      .setColor(0xf1c40f)
      .setTitle("🎉 Giveaway Ended!")
      .addFields(
        { name: "Prize", value: giveaway.prize },
        {
          name: "Winners",
          value:
            winners.length > 0
              ? winners.map((id) => `<@${id}>`).join(", ")
              : "No one entered — no winners!",
        },
      )
      .setTimestamp();

    if (giveaway.messageId) {
      try {
        const original = await ch.messages.fetch(giveaway.messageId);
        await original.edit({ embeds: [embed], components: [] });
      } catch {}
    }

    await ch.send({
      content:
        winners.length > 0
          ? `🎊 Congratulations ${winners.map((id) => `<@${id}>`).join(", ")}! You won **${giveaway.prize}**!`
          : `The giveaway for **${giveaway.prize}** ended with no entries.`,
    });
  } catch (err) {
    logger.error({ err }, "Failed to end giveaway");
  }
}

export async function handleGiveaway(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const guild = interaction.guild!;

  if (interaction.commandName === "setgiveaway") {
    const role = interaction.options.getRole("role", true);
    await db
      .insert(guildSettingsTable)
      .values({ guildId: guild.id, giveawayPingRoleId: role.id })
      .onConflictDoUpdate({ target: guildSettingsTable.guildId, set: { giveawayPingRoleId: role.id } });
    await interaction.reply({ content: `✅ Giveaway alerts will ping **${role.name}**.`, ephemeral: true });
    return;
  }

  if (interaction.commandName === "giveaway") {
    const sub = interaction.options.getSubcommand();
    if (sub !== "start") return;

    const prize = interaction.options.getString("prize", true);
    const durationStr = interaction.options.getString("duration", true);
    const winnerCount = interaction.options.getInteger("winners") ?? 1;
    const inlinePingRole = interaction.options.getRole("ping-role");
    const ms = parseDuration(durationStr);
    if (!ms) {
      await interaction.reply({ content: "Invalid duration. Use format like `10m`, `1h`, `2d`.", ephemeral: true });
      return;
    }

    const endsAt = new Date(Date.now() + ms);

    // Inline role takes priority; fall back to guild-wide default
    let pingRoleId = inlinePingRole?.id ?? null;
    if (!pingRoleId) {
      const [settings] = await db.select().from(guildSettingsTable).where(eq(guildSettingsTable.guildId, guild.id));
      pingRoleId = settings?.giveawayPingRoleId ?? null;
    }

    await interaction.deferReply();

    const embed = new EmbedBuilder()
      .setColor(0xf1c40f)
      .setTitle("🎉 Giveaway!")
      .addFields(
        { name: "Prize", value: prize },
        { name: "Winners", value: `${winnerCount}`, inline: true },
        { name: "Ends", value: `<t:${Math.floor(endsAt.getTime() / 1000)}:R>`, inline: true },
      )
      .setFooter({ text: "React with 🎉 to enter!" })
      .setTimestamp(endsAt);

    const msg = await interaction.editReply({
      content: pingRoleId ? `<@&${pingRoleId}> A new giveaway has started!` : "A new giveaway has started!",
      embeds: [embed],
    });

    await msg.react("🎉");

    const [inserted] = await db
      .insert(giveawaysTable)
      .values({
        guildId: guild.id,
        channelId: interaction.channelId,
        messageId: msg.id,
        prize,
        winnerCount,
        endsAt,
      })
      .returning();

    if (inserted) {
      setTimeout(() => endGiveaway(inserted.id, interaction.client), ms);
    }
  }
}

// Handle giveaway entries via reactions
export async function handleGiveawayReaction(
  reaction: import("discord.js").MessageReaction,
  user: import("discord.js").User,
  add: boolean,
): Promise<void> {
  if (user.bot || reaction.emoji.name !== "🎉") return;
  const [giveaway] = await db
    .select()
    .from(giveawaysTable)
    .where(and(eq(giveawaysTable.messageId, reaction.message.id), eq(giveawaysTable.ended, "false")));
  if (!giveaway) return;

  const entries = giveaway.entries ?? [];
  const updated = add
    ? entries.includes(user.id) ? entries : [...entries, user.id]
    : entries.filter((id) => id !== user.id);

  await db.update(giveawaysTable).set({ entries: updated }).where(eq(giveawaysTable.id, giveaway.id));
}
