import {
  ActionRowBuilder,
  ChatInputCommandInteraction,
  GuildMember,
  EmbedBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  TextChannel,
} from "discord.js";
import {
  addTrack,
  getQueue,
  joinChannel,
  pauseTrack,
  resumeTrack,
  searchVideos,
  setLoop,
  setVolume,
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

export const volumeCommand = new SlashCommandBuilder()
  .setName("volume")
  .setDescription("Set the music volume (0–100)")
  .addIntegerOption((o) =>
    o.setName("level").setDescription("Volume level (0–100)").setRequired(true).setMinValue(0).setMaxValue(100)
  );

export const searchCommand = new SlashCommandBuilder()
  .setName("search")
  .setDescription("Search YouTube and pick a song to play")
  .addStringOption((o) =>
    o.setName("query").setDescription("Song or artist name").setRequired(true)
  );

export async function handleSearchSelect(interaction: StringSelectMenuInteraction) {
  const url = interaction.values[0];
  const guildId = interaction.guildId!;
  const member = interaction.member as GuildMember;

  await interaction.deferUpdate();

  try {
    const queue = await joinChannel(member, interaction.channel as TextChannel);
    const track = await addTrack(guildId, url, member.user.tag);
    const q = getQueue(guildId)!;
    const isNowPlaying = q.tracks[0]?.url === track.url && q.tracks.length === 1;

    const embed = new EmbedBuilder()
      .setColor(0x1db954)
      .setTitle(isNowPlaying ? "▶️ Now Playing" : "➕ Added to Queue")
      .setDescription(`**${track.title}**`)
      .addFields(
        { name: "Requested by", value: track.requestedBy, inline: true },
        { name: "Position", value: isNowPlaying ? "Now" : `#${q.tracks.length}`, inline: true }
      );

    await interaction.editReply({ embeds: [embed], components: [] });
  } catch (err: any) {
    await interaction.editReply({ content: `❌ ${err.message}`, components: [] }).catch(() => {});
  }
}

export async function handleMusicCommand(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild) {
    await interaction.reply({ content: "Must be used in a server.", flags: 64 });
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
      await interaction.reply({ content: "⏭️ Skipped.", flags: 64 });

    } else if (cmd === "stop") {
      stopAndLeave(guildId);
      await interaction.reply({ content: "⏹️ Stopped and left the voice channel.", flags: 64 });

    } else if (cmd === "pause") {
      pauseTrack(guildId);
      await interaction.reply({ content: "⏸️ Paused.", flags: 64 });

    } else if (cmd === "resume") {
      resumeTrack(guildId);
      await interaction.reply({ content: "▶️ Resumed.", flags: 64 });

    } else if (cmd === "queue") {
      const q = getQueue(guildId);
      if (!q || q.tracks.length === 0) {
        await interaction.reply({ content: "The queue is empty.", flags: 64 });
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
        await interaction.reply({ content: "Nothing is playing.", flags: 64 });
        return;
      }
      setLoop(guildId, !q.loop);
      await interaction.reply({ content: `🔁 Loop is now **${!q.loop ? "ON" : "OFF"}**.`, flags: 64 });

    } else if (cmd === "nowplaying") {
      const q = getQueue(guildId);
      if (!q || q.tracks.length === 0) {
        await interaction.reply({ content: "Nothing is playing.", flags: 64 });
        return;
      }
      const track = q.tracks[0];
      const embed = new EmbedBuilder()
        .setColor(0x1db954)
        .setTitle("Now Playing")
        .setDescription(`**${track.title}**`)
        .addFields(
          { name: "Requested by", value: track.requestedBy, inline: true },
          { name: "Loop", value: q.loop ? "ON" : "OFF", inline: true },
          { name: "Volume", value: `${q.volume}%`, inline: true }
        );
      await interaction.reply({ embeds: [embed] });

    } else if (cmd === "volume") {
      const level = interaction.options.getInteger("level", true);
      setVolume(guildId, level);
      await interaction.reply({ content: `🔊 Volume set to **${level}%**.`, flags: 64 });

    } else if (cmd === "search") {
      const query = interaction.options.getString("query", true);
      await interaction.deferReply();

      const results = await searchVideos(query, 5);
      if (!results.length) {
        await interaction.editReply({ content: "❌ No results found." });
        return;
      }

      const menu = new StringSelectMenuBuilder()
        .setCustomId(`search_select:${interaction.user.id}`)
        .setPlaceholder("Pick a song to play…")
        .addOptions(
          results.map((r, i) => ({
            label: r.title.slice(0, 100),
            description: `${r.channel} • ${r.duration}`.slice(0, 100),
            value: r.url,
            emoji: ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣"][i],
          }))
        );

      const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);

      const embed = new EmbedBuilder()
        .setColor(0x1db954)
        .setTitle(`🔍 Search results for "${query}"`)
        .setDescription(
          results
            .map((r, i) => `${["1️⃣","2️⃣","3️⃣","4️⃣","5️⃣"][i]} **${r.title}** — ${r.channel} \`${r.duration}\``)
            .join("\n")
        )
        .setFooter({ text: "Select a song below • expires in 30s" });

      await interaction.editReply({ embeds: [embed], components: [row] });

      // Disable the menu after 30 seconds
      setTimeout(async () => {
        await interaction.editReply({ components: [] }).catch(() => {});
      }, 30_000);
    }
  } catch (err: any) {
    const msg = `❌ ${err.message}`;
    if (interaction.replied || interaction.deferred) {
      await interaction.editReply({ content: msg }).catch(() => {});
    } else {
      await interaction.reply({ content: msg, flags: 64 }).catch(() => {});
    }
  }
}
