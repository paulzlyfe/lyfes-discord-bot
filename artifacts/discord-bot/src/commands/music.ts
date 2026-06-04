import {
  ChatInputCommandInteraction,
  GuildMember,
  EmbedBuilder,
  SlashCommandBuilder,
  TextChannel,
} from "discord.js";
import {
  addTrack,
  getQueue,
  joinChannel,
  pauseTrack,
  resumeTrack,
  setLoop,
  skipTrack,
  stopAndLeave,
} from "../music.js";

export const playCommand = new SlashCommandBuilder()
  .setName("play")
  .setDescription("Play a song or add it to the queue")
  .addStringOption((o) =>
    o.setName("query").setDescription("Song name or YouTube URL").setRequired(true)
  );

export const skipCommand = new SlashCommandBuilder()
  .setName("skip")
  .setDescription("Skip the current song");

export const stopCommand = new SlashCommandBuilder()
  .setName("stop")
  .setDescription("Stop music and leave the voice channel");

export const pauseCommand = new SlashCommandBuilder()
  .setName("pause")
  .setDescription("Pause the current song");

export const resumeCommand = new SlashCommandBuilder()
  .setName("resume")
  .setDescription("Resume the paused song");

export const queueCommand = new SlashCommandBuilder()
  .setName("queue")
  .setDescription("Show the music queue");

export const loopCommand = new SlashCommandBuilder()
  .setName("loop")
  .setDescription("Toggle loop for the current song");

export const nowPlayingCommand = new SlashCommandBuilder()
  .setName("nowplaying")
  .setDescription("Show what's currently playing");

export async function handleMusicCommand(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild) {
    await interaction.reply({ content: "Must be used in a server.", ephemeral: true });
    return;
  }

  const member = interaction.member as GuildMember;
  const guildId = interaction.guild.id;
  const cmd = interaction.commandName;

  try {
    if (cmd === "play") {
      const query = interaction.options.getString("query", true);
      await interaction.deferReply();

      const queue = await joinChannel(member, interaction.channel as TextChannel);
      const track = await addTrack(guildId, query, member.user.tag);
      const q = getQueue(guildId)!;

      const isNowPlaying = q.tracks[0]?.url === track.url && q.tracks.length === 1;

      const embed = new EmbedBuilder()
        .setColor(0x1db954)
        .setTitle(isNowPlaying ? "Now Playing" : "Added to Queue")
        .setDescription(`**${track.title}**`)
        .addFields(
          { name: "Requested by", value: track.requestedBy, inline: true },
          { name: "Queue position", value: isNowPlaying ? "Now" : `#${q.tracks.length}`, inline: true }
        );

      await interaction.editReply({ embeds: [embed] });

    } else if (cmd === "skip") {
      skipTrack(guildId);
      await interaction.reply({ content: "⏭️ Skipped.", ephemeral: true });

    } else if (cmd === "stop") {
      stopAndLeave(guildId);
      await interaction.reply({ content: "⏹️ Stopped and left the voice channel.", ephemeral: true });

    } else if (cmd === "pause") {
      pauseTrack(guildId);
      await interaction.reply({ content: "⏸️ Paused.", ephemeral: true });

    } else if (cmd === "resume") {
      resumeTrack(guildId);
      await interaction.reply({ content: "▶️ Resumed.", ephemeral: true });

    } else if (cmd === "queue") {
      const q = getQueue(guildId);
      if (!q || q.tracks.length === 0) {
        await interaction.reply({ content: "The queue is empty.", ephemeral: true });
        return;
      }
      const embed = new EmbedBuilder()
        .setColor(0x1db954)
        .setTitle("Music Queue")
        .setDescription(
          q.tracks
            .slice(0, 10)
            .map((t, i) => `${i === 0 ? "▶️" : `${i + 1}.`} **${t.title}** — ${t.requestedBy}`)
            .join("\n")
        )
        .setFooter({ text: `${q.tracks.length} tracks total${q.loop ? " • Loop ON" : ""}` });
      await interaction.reply({ embeds: [embed] });

    } else if (cmd === "loop") {
      const q = getQueue(guildId);
      if (!q) {
        await interaction.reply({ content: "Nothing is playing.", ephemeral: true });
        return;
      }
      setLoop(guildId, !q.loop);
      await interaction.reply({ content: `🔁 Loop is now **${!q.loop ? "ON" : "OFF"}**.`, ephemeral: true });

    } else if (cmd === "nowplaying") {
      const q = getQueue(guildId);
      if (!q || q.tracks.length === 0) {
        await interaction.reply({ content: "Nothing is playing.", ephemeral: true });
        return;
      }
      const track = q.tracks[0];
      const embed = new EmbedBuilder()
        .setColor(0x1db954)
        .setTitle("Now Playing")
        .setDescription(`**${track.title}**`)
        .addFields(
          { name: "Requested by", value: track.requestedBy, inline: true },
          { name: "Loop", value: q.loop ? "ON" : "OFF", inline: true }
        );
      await interaction.reply({ embeds: [embed] });
    }
  } catch (err: any) {
    const msg = `❌ ${err.message}`;
    if (interaction.replied || interaction.deferred) {
      await interaction.editReply({ content: msg }).catch(() => {});
    } else {
      await interaction.reply({ content: msg, ephemeral: true }).catch(() => {});
    }
  }
}
