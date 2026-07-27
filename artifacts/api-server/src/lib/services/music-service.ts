import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
} from "@discordjs/voice";
import type { VoiceChannel, StageChannel } from "discord.js";
import playdl from "play-dl";
import { logger } from "../logger";
import type { TextBasedChannel } from "discord.js";

interface Song {
  title: string;
  url: string;
}

interface GuildMusicState {
  queue: Song[];
  currentSong: Song | null;
  player: ReturnType<typeof createAudioPlayer>;
  connection: ReturnType<typeof joinVoiceChannel> | null;
  textChannel: TextBasedChannel | null;
}

const states = new Map<string, GuildMusicState>();

function createState(): GuildMusicState {
  return {
    queue: [],
    currentSong: null,
    player: createAudioPlayer(),
    connection: null,
    textChannel: null,
  };
}

async function playNext(guildId: string): Promise<void> {
  const state = states.get(guildId);
  if (!state) return;

  const next = state.queue.shift();
  if (!next) {
    state.currentSong = null;
    state.connection?.destroy();
    state.connection = null;
    states.delete(guildId);
    return;
  }

  state.currentSong = next;

  try {
    const stream = await playdl.stream(next.url, { quality: 2 });
    const resource = createAudioResource(stream.stream, { inputType: stream.type });
    state.player.play(resource);
    if (state.textChannel?.isTextBased()) {
      await (state.textChannel as import("discord.js").TextChannel).send(
        `▶ Now playing: **${next.title}**`,
      );
    }
  } catch (err) {
    logger.error({ err, song: next.title }, "Failed to stream song, skipping");
    await playNext(guildId);
  }
}

export function getMusicService() {
  return {
    getState(guildId: string): GuildMusicState | undefined {
      return states.get(guildId);
    },

    async play(
      guildId: string,
      query: string,
      voiceChannel: VoiceChannel | StageChannel,
      textChannel: TextBasedChannel,
    ): Promise<{ title: string; queued: boolean }> {
      // Resolve the song info
      let url = query;
      let title = query;

      const isUrl = /^https?:\/\//.test(query);
      if (isUrl) {
        const info = await playdl.video_info(query).catch(() => null);
        title = info?.video_details?.title ?? query;
      } else {
        const results = await playdl.search(query, { source: { youtube: "video" }, limit: 1 });
        if (!results.length) throw new Error("No results found for that search.");
        url = results[0]!.url;
        title = results[0]!.title ?? query;
      }

      let state = states.get(guildId);
      const isPlaying = !!state?.currentSong;

      if (!state) {
        state = createState();
        states.set(guildId, state);

        const connection = joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId,
          adapterCreator: voiceChannel.guild.voiceAdapterCreator,
        });

        state.connection = connection;
        state.textChannel = textChannel;

        connection.subscribe(state.player);

        state.player.on(AudioPlayerStatus.Idle, () => {
          playNext(guildId).catch((err) =>
            logger.error({ err }, "Error advancing queue"),
          );
        });

        state.player.on("error", (err) => {
          logger.error({ err }, "Audio player error");
          playNext(guildId).catch(() => {});
        });

        try {
          await entersState(connection, VoiceConnectionStatus.Ready, 10_000);
        } catch {
          connection.destroy();
          states.delete(guildId);
          throw new Error("Could not connect to voice channel.");
        }
      }

      state.queue.push({ title, url });

      if (!isPlaying) {
        await playNext(guildId);
        return { title, queued: false };
      }

      return { title, queued: true };
    },

    stop(guildId: string): void {
      const state = states.get(guildId);
      if (!state) return;
      state.queue = [];
      state.player.stop(true);
      state.connection?.destroy();
      states.delete(guildId);
    },

    skip(guildId: string): boolean {
      const state = states.get(guildId);
      if (!state?.currentSong) return false;
      state.player.stop();
      return true;
    },
  };
}
