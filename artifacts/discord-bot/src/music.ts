import {
  AudioPlayer,
  AudioPlayerStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  getVoiceConnection,
  joinVoiceChannel,
  VoiceConnectionStatus,
} from "@discordjs/voice";
import { GuildMember, TextChannel, VoiceChannel } from "discord.js";
import playdl from "play-dl";

export interface Track {
  title: string;
  url: string;
  requestedBy: string;
}

interface GuildQueue {
  tracks: Track[];
  player: AudioPlayer;
  playing: boolean;
  volume: number;
  loop: boolean;
  textChannel: TextChannel;
}

const queues = new Map<string, GuildQueue>();

export function getQueue(guildId: string) {
  return queues.get(guildId);
}

export async function joinChannel(member: GuildMember, textChannel: TextChannel) {
  const voiceChannel = member.voice.channel as VoiceChannel;
  if (!voiceChannel) throw new Error("You must be in a voice channel.");

  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: voiceChannel.guild.id,
    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
  });

  await entersState(connection, VoiceConnectionStatus.Ready, 10_000);

  let queue = queues.get(voiceChannel.guild.id);
  if (!queue) {
    const player = createAudioPlayer();
    queue = { tracks: [], player, playing: false, volume: 80, loop: false, textChannel };
    queues.set(voiceChannel.guild.id, queue);
    connection.subscribe(player);

    player.on(AudioPlayerStatus.Idle, () => {
      const q = queues.get(voiceChannel.guild.id);
      if (!q) return;
      if (q.loop && q.tracks.length > 0) {
        playNext(voiceChannel.guild.id);
      } else {
        q.tracks.shift();
        if (q.tracks.length > 0) {
          playNext(voiceChannel.guild.id);
        } else {
          q.playing = false;
          q.textChannel.send("Queue finished. Use `/play` to add more songs.").catch(() => {});
        }
      }
    });

    player.on("error", (err) => {
      console.error("Audio player error:", err.message);
      const q = queues.get(voiceChannel.guild.id);
      if (q) {
        q.tracks.shift();
        if (q.tracks.length > 0) playNext(voiceChannel.guild.id);
        else q.playing = false;
      }
    });
  } else {
    queue.textChannel = textChannel;
  }

  return queue;
}

async function playNext(guildId: string) {
  const queue = queues.get(guildId);
  if (!queue || queue.tracks.length === 0) return;

  const track = queue.tracks[0];
  try {
    const stream = await playdl.stream(track.url, { quality: 2 });
    const resource = createAudioResource(stream.stream, {
      inputType: stream.type,
    });
    queue.player.play(resource);
    queue.playing = true;
    queue.textChannel
      .send(`Now playing: **${track.title}** (requested by ${track.requestedBy})`)
      .catch(() => {});
  } catch (err: any) {
    queue.textChannel.send(`Failed to play **${track.title}**: ${err.message}`).catch(() => {});
    queue.tracks.shift();
    if (queue.tracks.length > 0) playNext(guildId);
    else queue.playing = false;
  }
}

export async function addTrack(
  guildId: string,
  query: string,
  requestedBy: string
): Promise<Track> {
  const queue = queues.get(guildId);
  if (!queue) throw new Error("Not connected to a voice channel.");

  let track: Track;

  if (playdl.yt_validate(query) === "video") {
    const info = await playdl.video_info(query);
    track = {
      title: info.video_details.title ?? "Unknown",
      url: info.video_details.url,
      requestedBy,
    };
  } else {
    const results = await playdl.search(query, { source: { youtube: "video" }, limit: 1 });
    if (!results.length) throw new Error("No results found.");
    track = {
      title: results[0].title ?? "Unknown",
      url: results[0].url,
      requestedBy,
    };
  }

  queue.tracks.push(track);

  if (!queue.playing) {
    await playNext(guildId);
  }

  return track;
}

export function skipTrack(guildId: string) {
  const queue = queues.get(guildId);
  if (!queue || queue.tracks.length === 0) throw new Error("Nothing is playing.");
  queue.player.stop();
}

export function pauseTrack(guildId: string) {
  const queue = queues.get(guildId);
  if (!queue) throw new Error("Nothing is playing.");
  queue.player.pause();
}

export function resumeTrack(guildId: string) {
  const queue = queues.get(guildId);
  if (!queue) throw new Error("Nothing is playing.");
  queue.player.unpause();
}

export function stopAndLeave(guildId: string) {
  const queue = queues.get(guildId);
  if (queue) {
    queue.tracks = [];
    queue.player.stop();
    queue.playing = false;
    queues.delete(guildId);
  }
  const connection = getVoiceConnection(guildId);
  if (connection) connection.destroy();
}

export function setLoop(guildId: string, enabled: boolean) {
  const queue = queues.get(guildId);
  if (!queue) throw new Error("Nothing is playing.");
  queue.loop = enabled;
}
