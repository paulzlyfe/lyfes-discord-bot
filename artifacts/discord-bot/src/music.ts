import {
  AudioPlayer,
  AudioPlayerStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  getVoiceConnection,
  joinVoiceChannel,
  StreamType,
  VoiceConnectionStatus,
} from "@discordjs/voice";
import { GuildMember, TextChannel, VoiceChannel } from "discord.js";
import { Readable } from "stream";
import * as playdl from "play-dl";

// If YOUTUBE_COOKIE is set, authenticate play-dl so age-restricted and
// region-locked videos work. This is optional — unauthenticated playback
// works for most public videos.
if (process.env.YOUTUBE_COOKIE) {
  playdl.setToken({ youtube: { cookie: process.env.YOUTUBE_COOKIE } })
    .catch((e) => console.warn("[music] Failed to set YouTube cookie:", e.message));
}

export interface Track {
  title: string;
  url: string;
  requestedBy: string;
}

interface GuildQueue {
  tracks: Track[];
  player: AudioPlayer;
  playing: boolean;
  loop: boolean;
  volume: number;
  textChannel: TextChannel;
}

const queues = new Map<string, GuildQueue>();

export function getQueue(guildId: string) {
  return queues.get(guildId);
}

// Resolve a search query or URL to a { title, url } pair using play-dl.
// For URLs the InnerTube video_info call is used; for text queries
// play-dl's search endpoint is used (no browser / yt-dlp required).
async function getVideoInfo(query: string): Promise<{ title: string; url: string }> {
  const isUrl = query.startsWith("http://") || query.startsWith("https://");
  if (isUrl) {
    const info = await playdl.video_info(query);
    return {
      title: info.video_details.title ?? "Unknown",
      url: query,
    };
  }
  const results = await playdl.search(query, { source: { youtube: "video" }, limit: 1 });
  if (!results.length) throw new Error("No results found for that query.");
  const first = results[0];
  return {
    title: first.title ?? "Unknown",
    url: first.url ?? query,
  };
}

// Open an audio stream for a YouTube URL via play-dl's InnerTube API.
// Returns the Readable stream and the StreamType so @discordjs/voice can
// choose the most efficient decoder (usually WebmOpus → no re-encode needed).
async function getAudioStream(url: string): Promise<{ stream: Readable; type: StreamType }> {
  const result = await playdl.stream(url, { discordPlayerCompatibility: true });
  return { stream: result.stream as Readable, type: result.type as unknown as StreamType };
}

export async function joinChannel(member: GuildMember, textChannel: TextChannel) {
  const voiceChannel = member.voice.channel as VoiceChannel;
  if (!voiceChannel) throw new Error("You must be in a voice channel.");

  // Fail fast with a clear message if permissions are missing
  const me = voiceChannel.guild.members.me;
  if (me) {
    const perms = voiceChannel.permissionsFor(me);
    const missing: string[] = [];
    if (!perms?.has("ViewChannel")) missing.push("View Channel");
    if (!perms?.has("Connect")) missing.push("Connect");
    if (!perms?.has("Speak")) missing.push("Speak");
    if (missing.length) {
      throw new Error(`I'm missing permissions on that voice channel: **${missing.join(", ")}**. Please grant these to my role.`);
    }
  }

  console.log(`[voice] Joining channel "${voiceChannel.name}" (${voiceChannel.id}) in guild ${voiceChannel.guild.id}`);

  // Destroy any stale connection before creating a new one
  const existing = getVoiceConnection(voiceChannel.guild.id);
  if (existing && existing.state.status !== VoiceConnectionStatus.Ready) {
    console.log(`[voice] Destroying stale connection in state: ${existing.state.status}`);
    existing.destroy();
  }

  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: voiceChannel.guild.id,
    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: false,
  });

  // Track state transitions for diagnostics.
  let everReachedConnecting = false;
  const stateHistory: string[] = [];
  // Track which networking instances we've already tapped to avoid duplicate listeners.
  const tappedNetworking = new WeakSet();

  connection.on("stateChange", (oldState, newState) => {
    console.log(`[voice] ${oldState.status} → ${newState.status}`);
    stateHistory.push(newState.status);
    if (newState.status === VoiceConnectionStatus.Connecting) everReachedConnecting = true;

    // Tap into the internal Networking object to capture WebSocket close codes and
    // sub-state transitions. VoiceConnection doesn't forward these events itself.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const net = (newState as any).networking;
    if (net && !tappedNetworking.has(net)) {
      tappedNetworking.add(net);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      net.on("stateChange", (o: any, n: any) => {
        const oCode = o?.code ?? o?.status ?? String(o);
        const nCode = n?.code ?? n?.status ?? String(n);
        console.log(`[voice-net] networking sub-state: ${oCode} → ${nCode}`);

        // Attach WebSocket close/error listener on new states that carry a ws.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ws = n?.ws as any;
        if (ws) {
          ws.once("close", (code: number, reason: Buffer) => {
            console.log(`[voice-ws-close] code=${code} reason="${reason?.toString?.() ?? ""}"`);
          });
          ws.on("error", (e: Error) => {
            console.log(`[voice-ws-error] ${e.message}`);
          });
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const udp = n?.udp as any;
        if (udp) {
          udp.on("error", (e: Error) => console.log(`[voice-udp-error] ${e.message}`));
        }
      });

      // Networking emits "close" with the numeric WebSocket close code after
      // destructuring it from the CloseEvent. This is the cleanest way to get
      // the actual code Discord sent (4006 = session invalid, 4014 = disconnected, etc.)
      net.on("close", (code: number) => console.log(`[voice-net-close] WebSocket closed by Discord — code=${code}`));
      net.on("debug", (msg: string) => console.log(`[voice-net-debug] ${msg}`));
      net.on("error", (e: Error) => console.log(`[voice-net-error] ${e.message}`));
    }
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
    console.log("[voice] Connection ready ✅");
  } catch (err) {
    const stuck = connection.state.status;
    connection.destroy();

    if (everReachedConnecting) {
      // Reached "connecting" (gateway events delivered OK) but UDP failed.
      throw new Error(
        `Voice connection failed at the UDP/networking stage (states: ${stateHistory.join(" → ")}). ` +
        "Check the host logs for '[voice-net-*]' lines to see what happened. " +
        "This may be a transient network issue — try again, or check if Discord's voice servers are reachable (outbound UDP)."
      );
    }
    throw new Error(
      `Voice connection stuck at signalling — Discord's VOICE_SERVER_UPDATE/VOICE_STATE_UPDATE never arrived. ` +
      "Check the host logs for '[voice]' state transitions and '[voice-net-debug]' lines."
    );
  }

  let queue = queues.get(voiceChannel.guild.id);
  if (!queue) {
    const player = createAudioPlayer();
    queue = { tracks: [], player, playing: false, loop: false, volume: 100, textChannel };
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
          q.textChannel.send("✅ Queue finished. Use `/play` to add more songs.").catch(() => {});
        }
      }
    });

    player.on("error", (err) => {
      console.error("Audio player error:", err.message);
      const q = queues.get(voiceChannel.guild.id);
      if (q) {
        q.textChannel.send(`❌ Playback error: ${err.message}`).catch(() => {});
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
    const { stream, type } = await getAudioStream(track.url);
    const resource = createAudioResource(stream, { inputType: type });

    queue.player.play(resource);
    queue.playing = true;
    queue.textChannel
      .send(`🎵 Now playing: **${track.title}** (requested by ${track.requestedBy})`)
      .catch(() => {});
  } catch (err: any) {
    console.error("playNext error:", err);
    queue.textChannel.send(`❌ Failed to play **${track.title}**: ${err.message}`).catch(() => {});
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

  const info = await getVideoInfo(query);
  const track: Track = { ...info, requestedBy };

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

export function setVolume(guildId: string, volume: number) {
  const queue = queues.get(guildId);
  if (!queue) throw new Error("Nothing is playing.");
  if (volume < 0 || volume > 100) throw new Error("Volume must be between 0 and 100.");
  queue.volume = volume;
}
