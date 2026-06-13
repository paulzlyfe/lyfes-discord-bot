import {
  ChatInputCommandInteraction,
  Client,
  Collection,
  EmbedBuilder,
  GuildMember,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextChannel,
} from "discord.js";
import {
  getGiveawayConfig,
  setGiveawayChannel,
  setGiveawayPingRole,
  addGiveawayRole,
  removeGiveawayRole,
  createGiveaway,
  markGiveawayEnded,
  getPendingGiveaways,
  type GiveawayRow,
} from "../db.js";

// ─── Duration parser ──────────────────────────────────────────────────────────
export function parseDuration(raw: string): number {
  const match = raw.trim().match(/^(\d+)(s|m|h|d)$/i);
  if (!match) return 0;
  const n = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const map: Record<string, number> = {
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  return n * map[unit];
}

// ─── Permission check ─────────────────────────────────────────────────────────
// Admins can always run giveaways. Any role explicitly added via
// /giveaway-setup addrole is also permitted.
async function canRunGiveaway(member: GuildMember, guildId: string): Promise<boolean> {
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  const config = await getGiveawayConfig(guildId);
  const allowedIds: string[] = JSON.parse(config.allowed_role_ids || "[]");
  if (allowedIds.length === 0) return false;
  return member.roles.cache.some((r) => allowedIds.includes(r.id));
}

// ─── Command builders ─────────────────────────────────────────────────────────
export const giveawaySetupCommand = new SlashCommandBuilder()
  .setName("giveaway-setup")
  .setDescription("Configure giveaways for this server")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((sub) =>
    sub
      .setName("channel")
      .setDescription("Set the channel where giveaways are posted")
      .addChannelOption((o) =>
        o.setName("channel").setDescription("Giveaway channel").setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("pingrole")
      .setDescription("Set the role that gets pinged when a giveaway starts (or clear it)")
      .addRoleOption((o) =>
        o.setName("role").setDescription("Role to ping — leave blank to clear")
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("addrole")
      .setDescription("Add a role that is allowed to start giveaways")
      .addRoleOption((o) =>
        o.setName("role").setDescription("Role to allow").setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("removerole")
      .setDescription("Remove a role from the giveaway allowed list")
      .addRoleOption((o) =>
        o.setName("role").setDescription("Role to remove").setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub.setName("list").setDescription("Show current giveaway configuration")
  );

export const giveawayCommand = new SlashCommandBuilder()
  .setName("giveaway")
  .setDescription("Start a giveaway")
  .addStringOption((o) =>
    o.setName("prize").setDescription("What are you giving away?").setRequired(true)
  )
  .addStringOption((o) =>
    o
      .setName("duration")
      .setDescription("How long should it last? (e.g. 30m, 2h, 1d, 7d)")
      .setRequired(true)
  )
  .addIntegerOption((o) =>
    o
      .setName("winners")
      .setDescription("How many winners to pick? (default: 1)")
      .setMinValue(1)
      .setMaxValue(20)
  );

// ─── End a giveaway ───────────────────────────────────────────────────────────
export async function endGiveaway(client: Client, giveaway: GiveawayRow): Promise<void> {
  try {
    const channel = (await client.channels
      .fetch(giveaway.channel_id)
      .catch(() => null)) as TextChannel | null;
    if (!channel) return;

    const message = await channel.messages
      .fetch(giveaway.message_id)
      .catch(() => null);
    if (!message) return;

    const reaction = message.reactions.cache.get("🎉");
    const reactors = reaction
      ? (await reaction.users.fetch()).filter((u) => !u.bot)
      : new Collection();

    let winnerMentions: string[];
    if (reactors.size === 0) {
      winnerMentions = [];
    } else {
      const pool = [...reactors.keys()];
      const count = Math.min(giveaway.winner_count, pool.length);
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      winnerMentions = pool.slice(0, count).map((id) => `<@${id}>`);
    }

    const winnersText =
      winnerMentions.length > 0
        ? winnerMentions.join(", ")
        : "No one entered — no winners this time!";

    const endedEmbed = new EmbedBuilder()
      .setColor(0x95a5a6)
      .setTitle("🎉 GIVEAWAY ENDED")
      .setDescription(
        `**Prize:** ${giveaway.prize}\n\n` +
          `**Winner${winnerMentions.length !== 1 ? "s" : ""}:** ${winnersText}`
      )
      .setFooter({ text: `${giveaway.winner_count} winner(s) were selected` })
      .setTimestamp();

    await message.edit({ embeds: [endedEmbed] }).catch(() => {});

    if (winnerMentions.length > 0) {
      await channel
        .send({
          content:
            `🎊 Congratulations ${winnerMentions.join(", ")}! ` +
            `You won **${giveaway.prize}**!`,
        })
        .catch(() => {});
    } else {
      await channel
        .send({ content: "🎉 The giveaway ended but nobody entered — no winners!" })
        .catch(() => {});
    }

    await markGiveawayEnded(
      giveaway.id,
      winnerMentions.map((m) => m.replace(/<@|>/g, ""))
    );
  } catch (err) {
    console.error("[giveaway] Error ending giveaway:", err);
  }
}

// ─── Schedule a giveaway timer ────────────────────────────────────────────────
export function scheduleGiveaway(client: Client, giveaway: GiveawayRow): void {
  const msLeft = giveaway.ends_at - Date.now();
  if (msLeft <= 0) {
    void endGiveaway(client, giveaway);
    return;
  }
  setTimeout(() => void endGiveaway(client, giveaway), msLeft);
}

// ─── Resume giveaways after a restart ────────────────────────────────────────
export async function resumePendingGiveaways(client: Client): Promise<void> {
  const pending = await getPendingGiveaways().catch(() => [] as GiveawayRow[]);
  if (pending.length === 0) return;
  console.log(`[giveaway] Resuming ${pending.length} pending giveaway(s)`);
  for (const g of pending) {
    scheduleGiveaway(client, g);
  }
}

// ─── Command handler ──────────────────────────────────────────────────────────
export async function handleGiveawayCommand(
  interaction: ChatInputCommandInteraction,
  client: Client
): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ content: "Must be used in a server.", flags: 64 });
    return;
  }

  const guildId = interaction.guild.id;
  const cmd = interaction.commandName;
  const member = interaction.member as GuildMember;

  try {
    // ── /giveaway-setup ─────────────────────────────────────────────────────
    if (cmd === "giveaway-setup") {
      const sub = interaction.options.getSubcommand();

      // channel / addrole / removerole are owner-only
      const isOwner = interaction.user.id === interaction.guild.ownerId;
      if (["channel", "addrole", "removerole"].includes(sub) && !isOwner) {
        await interaction.reply({
          content: "❌ Only the server owner can use this command.",
          flags: 64,
        });
        return;
      }

      if (sub === "channel") {
        const ch = interaction.options.getChannel("channel", true);
        await setGiveawayChannel(guildId, ch.id);
        await interaction.reply({ content: `✅ Giveaway channel set to <#${ch.id}>.`, flags: 64 });

      } else if (sub === "pingrole") {
        const role = interaction.options.getRole("role");
        await setGiveawayPingRole(guildId, role?.id ?? null);
        await interaction.reply({
          content: role
            ? `✅ Giveaways will now ping **${role.name}** when they start.`
            : "✅ Giveaway ping role cleared — no role will be pinged.",
          flags: 64,
        });

      } else if (sub === "addrole") {
        const role = interaction.options.getRole("role", true);
        await addGiveawayRole(guildId, role.id);
        await interaction.reply({ content: `✅ **${role.name}** can now start giveaways.`, flags: 64 });

      } else if (sub === "removerole") {
        const role = interaction.options.getRole("role", true);
        await removeGiveawayRole(guildId, role.id);
        await interaction.reply({ content: `✅ **${role.name}** can no longer start giveaways.`, flags: 64 });

      } else if (sub === "list") {
        const config = await getGiveawayConfig(guildId);
        const allowedIds: string[] = JSON.parse(config.allowed_role_ids || "[]");
        const roleList =
          allowedIds.length > 0
            ? allowedIds.map((id) => `<@&${id}>`).join(", ")
            : "None configured — only members with Manage Messages can start giveaways.";

        const embed = new EmbedBuilder()
          .setColor(0xf39c12)
          .setTitle("🎉 Giveaway Configuration")
          .addFields(
            {
              name: "Giveaway Channel",
              value: config.channel_id
                ? `<#${config.channel_id}>`
                : "Not set — use `/giveaway-setup channel`",
            },
            {
              name: "Ping Role",
              value: config.ping_role_id
                ? `<@&${config.ping_role_id}>`
                : "None — use `/giveaway-setup pingrole`",
            },
            { name: "Allowed Roles", value: roleList }
          );

        await interaction.reply({ embeds: [embed], flags: 64 });
      }

    // ── /giveaway ───────────────────────────────────────────────────────────
    } else if (cmd === "giveaway") {
      if (!(await canRunGiveaway(member, guildId))) {
        await interaction.reply({
          content:
            "❌ You don't have permission to start giveaways. Ask an admin to add your role with `/giveaway-setup addrole`.",
          flags: 64,
        });
        return;
      }

      const prize = interaction.options.getString("prize", true);
      const durationRaw = interaction.options.getString("duration", true);
      const winnerCount = interaction.options.getInteger("winners") ?? 1;
      const ms = parseDuration(durationRaw);

      if (!ms) {
        await interaction.reply({
          content: "❌ Invalid duration. Use a format like `30m`, `2h`, `1d`, `7d`.",
          flags: 64,
        });
        return;
      }

      const config = await getGiveawayConfig(guildId);
      if (!config.channel_id) {
        await interaction.reply({
          content: "❌ No giveaway channel set. Ask an admin to run `/giveaway-setup channel` first.",
          flags: 64,
        });
        return;
      }

      const giveawayCh = (await client.channels
        .fetch(config.channel_id)
        .catch(() => null)) as TextChannel | null;
      if (!giveawayCh) {
        await interaction.reply({
          content: "❌ The configured giveaway channel no longer exists. Please set a new one.",
          flags: 64,
        });
        return;
      }

      const endsAt = Date.now() + ms;
      const endsTimestamp = Math.floor(endsAt / 1000);

      const embed = new EmbedBuilder()
        .setColor(0xf39c12)
        .setTitle("🎉 GIVEAWAY")
        .setDescription(
          `**${prize}**\n\n` +
            `React with 🎉 to enter!\n\n` +
            `**Ends:** <t:${endsTimestamp}:R> (<t:${endsTimestamp}:f>)\n` +
            `**Winners:** ${winnerCount}\n` +
            `**Hosted by:** ${interaction.user}`
        )
        .setFooter({ text: `${winnerCount} winner(s) • Ends` })
        .setTimestamp(endsAt);

      await interaction.deferReply({ flags: 64 });

      // Ping role if configured
      const pingContent = config.ping_role_id ? `<@&${config.ping_role_id}>` : undefined;
      const giveawayMsg = await giveawayCh.send({
        content: pingContent,
        embeds: [embed],
      });
      await giveawayMsg.react("🎉");

      const row = await createGiveaway(
        guildId,
        config.channel_id,
        giveawayMsg.id,
        prize,
        endsAt,
        winnerCount
      );

      scheduleGiveaway(client, row);

      await interaction.editReply({
        content: `✅ Giveaway started in <#${config.channel_id}>! It ends <t:${endsTimestamp}:R>.`,
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
