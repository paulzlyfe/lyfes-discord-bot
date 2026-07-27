import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  StreamType,
  entersState,
} from "@discordjs/voice";
import type { Readable } from "node:stream";
import type { VoiceChannel, StageChannel, TextChannel } from "discord.js";
import playdl from "play-dl";
import ytdl from "@distube/ytdl-core";
import { logger } from "../logger";
import type { TextBasedChannel } from "discord.js";

// Build a cookie-authenticated agent once at startup so all ytdl calls share it.
// YOUTUBE_COOKIE is the raw "cookie:" request header value copied from DevTools.
function buildAgent(): ReturnType<typeof ytdl.createAgent> | undefined {
  const raw = process.env["YOUTUBE_COOKIE"];
  if (!raw) return undefined;
  try {
    // Parse "name=value; name2=value2; ..." into the array createAgent expects
    const cookies = raw
      .split(";")
      .map((pair) => pair.trim())
      .filter(Boolean)
      .map((pair) => {
        const eq = pair.indexOf("=");
        return eq === -1
          ? null
          : { name: pair.slice(0, eq).trim(), value: pair.slice(eq + 1).trim() };
      })
      .filter((c): c is { name: string; value: string } => c !== null);
    return ytdl.createAgent(cookies);
  } catch (err) {
    logger.warn({ err }, "Failed to build YouTube cookie agent — playing without auth");
    return undefined;
  }
}

const ytdlAgent = buildAgent();

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

async function getStream(url: string): Promise<{ stream: Readable; type: StreamType }> {
  const stream = ytdl(url, {
    filter: "audioonly",
    quality: "highestaudio",
    highWaterMark: 1 << 25,
    ...(ytdlAgent ? { agent: ytdlAgent } : {}),
  }) as unknown as Readable;
  return { stream, type: StreamType.Arbitrary };
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
    const { stream, type } = await getStream(next.url);
    const resource = createAudioResource(stream, { inputType: type });
    state.player.play(resource);
    if (state.textChannel?.isTextBased()) {
      await (state.textChannel as TextChannel).send(
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
      // Resolve song metadata
      let url = query;
      let title = query;

      const isUrl = /^https?:\/\//.test(query);
      if (isUrl) {
        try {
          const info = await ytdl.getBasicInfo(url, ytdlAgent ? { agent: ytdlAgent } : {});
          title = info.videoDetails.title;
        } catch {
          title = query;
        }
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
          logger.error({ err }, "Audio player error, skipping");
          playNext(guildId).catch(() => {});
        });

        // Disconnect listener — clean up state if connection drops externally
        connection.on(VoiceConnectionStatus.Disconnected, async () => {
          try {
            // Give Discord 5s to reconnect before giving up
            await entersState(connection, VoiceConnectionStatus.Ready, 5_000);
          } catch {
            connection.destroy();
            states.delete(guildId);
          }
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
