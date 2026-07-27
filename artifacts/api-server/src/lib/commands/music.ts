import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
  type GuildMember,
} from "discord.js";
import { getMusicService } from "../services/music-service";

export const musicCommands = [
  new SlashCommandBuilder()
    .setName("play")
    .setDescription("Play a song — paste a URL or type a search query")
    .addStringOption((o) =>
      o.setName("query").setDescription("URL or song name to search").setRequired(true),
    )
    .setDMPermission(false),

  new SlashCommandBuilder()
    .setName("search")
    .setDescription("Search for a song by name and play it")
    .addStringOption((o) =>
      o.setName("query").setDescription("Song name to search").setRequired(true),
    )
    .setDMPermission(false),

  new SlashCommandBuilder()
    .setName("queue")
    .setDescription("Show the current music queue")
    .setDMPermission(false),

  new SlashCommandBuilder()
    .setName("stop")
    .setDescription("Stop music and leave the voice channel")
    .setDMPermission(false),

  new SlashCommandBuilder()
    .setName("skip")
    .setDescription("Skip the current song")
    .setDMPermission(false),
];

export async function handleMusic(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const cmd = interaction.commandName;
  const guild = interaction.guild!;
  const member = interaction.member as GuildMember;
  const voiceChannel = member.voice.channel;
  const music = getMusicService();

  if (cmd === "queue") {
    const state = music.getState(guild.id);
    if (!state || (!state.currentSong && state.queue.length === 0)) {
      await interaction.reply({ content: "Nothing is playing.", ephemeral: true });
      return;
    }
    const lines: string[] = [];
    if (state.currentSong) lines.push(`**Now playing:** ${state.currentSong.title}`);
    if (state.queue.length > 0) {
      lines.push("**Up next:**");
      state.queue.slice(0, 10).forEach((s, i) => lines.push(`${i + 1}. ${s.title}`));
      if (state.queue.length > 10) lines.push(`...and ${state.queue.length - 10} more`);
    }
    await interaction.reply({ content: lines.join("\n"), ephemeral: false });
    return;
  }

  if (cmd === "stop") {
    music.stop(guild.id);
    await interaction.reply({ content: "⏹ Stopped and left the voice channel." });
    return;
  }

  if (cmd === "skip") {
    const skipped = music.skip(guild.id);
    await interaction.reply({ content: skipped ? "⏭ Skipped." : "Nothing to skip." });
    return;
  }

  // /play or /search — needs voice channel
  if (!voiceChannel) {
    await interaction.reply({ content: "You need to be in a voice channel.", ephemeral: true });
    return;
  }

  const query = interaction.options.getString("query", true);
  await interaction.deferReply();

  try {
    const result = await music.play(guild.id, query, voiceChannel, interaction.channel!);
    if (result.queued) {
      await interaction.editReply({ content: `➕ Added to queue: **${result.title}**` });
    } else {
      const embed = new EmbedBuilder()
        .setColor(0x1db954)
        .setTitle("Now Playing")
        .setDescription(`**${result.title}**`)
        .setFooter({ text: `Requested by ${interaction.user.displayName}` });
      await interaction.editReply({ embeds: [embed] });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Could not play that track.";
    await interaction.editReply({ content: `❌ ${msg}` });
  }
}
