import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ChannelType,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type TextChannel,
} from "discord.js";
import { db } from "@workspace/db";
import { guildConfigsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

const DISCORD_BOT_TOKEN = process.env["DISCORD_BOT_TOKEN"];
const DISCORD_CLIENT_ID = process.env["DISCORD_CLIENT_ID"];

if (!DISCORD_BOT_TOKEN) {
  throw new Error("DISCORD_BOT_TOKEN environment variable is required");
}
if (!DISCORD_CLIENT_ID) {
  throw new Error("DISCORD_CLIENT_ID environment variable is required");
}

export const discordClient = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const setChannelCommand = new SlashCommandBuilder()
  .setName("setchannel")
  .setDescription("Set the channel where GitHub push updates are posted")
  .addChannelOption((option) =>
    option
      .setName("channel")
      .setDescription("The channel to receive GitHub updates")
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(true),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false);

async function registerCommands(): Promise<void> {
  const rest = new REST().setToken(DISCORD_BOT_TOKEN!);
  try {
    await rest.put(Routes.applicationCommands(DISCORD_CLIENT_ID!), {
      body: [setChannelCommand.toJSON()],
    });
    logger.info("Registered global slash commands");
  } catch (err) {
    logger.error({ err }, "Failed to register slash commands");
  }
}

async function handleSetChannel(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const channel = interaction.options.getChannel("channel", true);
  const guildId = interaction.guildId;

  if (!guildId) {
    await interaction.reply({
      content: "This command can only be used in a server.",
      ephemeral: true,
    });
    return;
  }

  await db
    .insert(guildConfigsTable)
    .values({ guildId, channelId: channel.id })
    .onConflictDoUpdate({
      target: guildConfigsTable.guildId,
      set: { channelId: channel.id },
    });

  await interaction.reply({
    content: `✅ GitHub push updates will now be posted to <#${channel.id}>.`,
    ephemeral: true,
  });

  logger.info({ guildId, channelId: channel.id }, "Guild channel configured");
}

discordClient.once("ready", async (client) => {
  logger.info({ tag: client.user.tag }, "Discord bot ready");
  await registerCommands();
});

discordClient.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "setchannel") {
    try {
      await handleSetChannel(interaction);
    } catch (err) {
      logger.error({ err }, "Error handling /setchannel");
      const msg = { content: "An error occurred. Please try again.", ephemeral: true };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(msg);
      } else {
        await interaction.reply(msg);
      }
    }
  }
});

/**
 * Post a GitHub push event embed to all configured guild channels.
 */
export async function postPushToChannels(embed: object): Promise<void> {
  const configs = await db.select().from(guildConfigsTable);

  for (const config of configs) {
    try {
      const channel = await discordClient.channels.fetch(config.channelId);
      if (channel && channel.isTextBased()) {
        await (channel as TextChannel).send({ embeds: [embed as never] });
      }
    } catch (err) {
      logger.error(
        { err, guildId: config.guildId, channelId: config.channelId },
        "Failed to post to Discord channel",
      );
    }
  }
}

export async function startDiscordBot(): Promise<void> {
  await discordClient.login(DISCORD_BOT_TOKEN);
}
