import {
  AudioPlayer,
  AudioPlayerStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  getVoiceConnection,
  joinVoiceChannel,
  StreamType,
  VoiceConnection,
  VoiceConnectionStatus,
} from "@discordjs/voice";
import { GuildMember, TextChannel, VoiceChannel } from "discord.js";
import { spawn, execFile } from "child_process";
import { promisify } from "util";
import { existsSync } from "fs";
import { Readable } from "stream";

const execFileAsync = promisify(execFile);

// /cookies.txt is mounted into the container via docker-compose (Netscape format).
// This includes HttpOnly cookies that document.cookie cannot read, which are the
// ones YouTube requires for authentication from datacenter IPs.
const COOKIES_FILE = "/cookies.txt";
const hasCookies = existsSync(COOKIES_FILE);
if (hasCookies) {
  console.log("[music] cookies.txt found — YouTube auth enabled ✅");
} else {
  console.warn("[music] No cookies.txt found — YouTube may block requests from this IP. See README.");
}

// Base yt-dlp flags for every invocation. Node.js is used as the JS runtime
// (available in the Docker image) to avoid yt-dlp's deno fallback warning.
function ytdlpBaseArgs(): string[] {
  return [
    "--js-runtimes", "node",
    ...(hasCookies ? ["--cookies", COOKIES_FILE] : []),
  ];
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

// Listener bookkeeping — joinVoiceChannel() returns the SAME connection object on
// repeated calls, so these must live at module scope to prevent duplicate handlers
// (the "MaxListenersExceededWarning: 11 error listeners" symptom).
const instrumentedConnections = new WeakSet<VoiceConnection>();
const tappedNetworking = new WeakSet<object>();
const connDiagnostics = new WeakMap<VoiceConnection, { history: string[]; everConnecting: boolean }>();

export function getQueue(guildId: string) {
  return queues.get(guildId);
}

// Translate raw yt-dlp failures into short, actionable messages instead of
// dumping a Python traceback into Discord.
function friendlyYtError(err: Error): Error {
  const msg = err?.message ?? "";
  if (/Sign in to confirm|cookies are no longer valid/i.test(msg)) {
    return new Error(
      "YouTube rejected the request — the cookies have likely expired. " +
      "Re-export cookies.txt (incognito → log into YouTube → export while the tab is open), " +
      "upload it to `~/bot/cookies.txt` on the server, then `docker compose restart lyfe-bot`."
    );
  }
  if (/Video unavailable/i.test(msg)) {
    return new Error("That video is unavailable (deleted, private, or region-blocked). Try another link.");
  }
  if (/Private video/i.test(msg)) {
    return new Error("That video is private.");
  }
  if (/age.?restricted|confirm your age/i.test(msg)) {
    return new Error("That video is age-restricted and can't be played.");
  }
  // Unknown failure: keep only the ERROR line so Discord doesn't get a wall of text.
  const errLine = msg.split("\n").find((l) => l.trim().startsWith("ERROR:"));
  return errLine ? new Error(errLine.trim()) : err;
}

async function getVideoInfo(query: string): Promise<{ title: string; url: string }> {
  const isUrl = query.startsWith("http://") || query.startsWith("https://");
  const args = [
    ...ytdlpBaseArgs(),
    "--no-playlist",
    "--print", "%(title)s\n%(webpage_url)s",
    "--quiet",
    isUrl ? query : `ytsearch1:${query}`,
  ];
  try {
    const { stdout } = await execFileAsync("yt-dlp", args, { timeout: 30_000 });
    const lines = stdout.trim().split("\n");
    return {
      title: lines[0] ?? "Unknown",
      url: lines[1] ?? query,
    };
  } catch (err: any) {
    throw friendlyYtError(err);
  }
}

function getAudioStream(url: string): Readable {
  const proc = spawn("yt-dlp", [
    ...ytdlpBaseArgs(),
    "-f", "bestaudio[ext=webm]/bestaudio/best",
    "--no-playlist",
    "-o", "-",
    "--quiet",
    url,
  ]);
  proc.stderr.on("data", (d: Buffer) => process.stderr.write(d));
  return proc.stdout as unknown as Readable;
}

export interface SearchResult {
  title: string;
  url: string;
  channel: string;
  duration: string;
}

// Search YouTube via yt-dlp (same cookie-authenticated path as playback).
// --flat-playlist avoids a full extraction per result, so it's fast.
export async function searchVideos(query: string, limit = 5): Promise<SearchResult[]> {
  const args = [
    ...ytdlpBaseArgs(),
    "--flat-playlist",
    "--print", "%(title)s\t%(url)s\t%(channel)s\t%(duration_string)s",
    "--quiet",
    `ytsearch${limit}:${query}`,
  ];
  try {
    const { stdout } = await execFileAsync("yt-dlp", args, { timeout: 30_000 });
    return stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [title, url, channel, duration] = line.split("\t");
        return {
          title: title || "Unknown",
          url: url || "",
          channel: channel && channel !== "NA" ? channel : "Unknown",
          duration: duration && duration !== "NA" ? duration : "?",
        };
      })
      .filter((r) => r.url);
  } catch (err: any) {
    throw friendlyYtError(err);
  }
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

  // Instrument each connection object exactly once — joinVoiceChannel() returns
  // the existing connection on repeated /play calls.
  if (!instrumentedConnections.has(connection)) {
    instrumentedConnections.add(connection);
    connDiagnostics.set(connection, { history: [], everConnecting: false });

    connection.on("stateChange", (oldState, newState) => {
      console.log(`[voice] ${oldState.status} → ${newState.status}`);
      const diag = connDiagnostics.get(connection);
      diag?.history.push(newState.status);
      if (diag && newState.status === VoiceConnectionStatus.Connecting) diag.everConnecting = true;

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
          if (ws && !tappedNetworking.has(ws)) {
            tappedNetworking.add(ws);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ws.once("close", (event: any) => {
              const code = typeof event === "object" ? event?.code : event;
              console.log(`[voice-ws-close] code=${code}`);
            });
            ws.on("error", (e: Error) => {
              console.log(`[voice-ws-error] ${e.message}`);
            });
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const udp = n?.udp as any;
          if (udp && !tappedNetworking.has(udp)) {
            tappedNetworking.add(udp);
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

    // Recover from transient drops (channel move, voice server change). If the
    // connection doesn't start reconnecting within 5s it's a hard disconnect
    // (e.g. 4014 kick) — destroy it so the next /play builds a clean one.
    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
        // Reconnecting on its own — leave it alone.
      } catch {
        if (connection.state.status !== VoiceConnectionStatus.Destroyed) {
          console.log("[voice] Hard disconnect — destroying connection (next /play rejoins cleanly)");
          connection.destroy();
        }
      }
    });
  }

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
    console.log("[voice] Connection ready ✅");
  } catch (err) {
    const diag = connDiagnostics.get(connection);
    if (connection.state.status !== VoiceConnectionStatus.Destroyed) connection.destroy();

    if (diag?.everConnecting) {
      // Reached "connecting" (gateway events delivered OK) but UDP failed.
      throw new Error(
        `Voice connection failed at the UDP/networking stage (states: ${diag.history.join(" → ")}). ` +
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

  // Always (re)subscribe — after a disconnect the connection object is brand new,
  // and a player with no subscriber auto-pauses: yt-dlp/ffmpeg run but audio goes
  // nowhere. Subscribing an already-subscribed pair is a safe no-op.
  connection.subscribe(queue.player);

  return queue;
}

async function playNext(guildId: string) {
  const queue = queues.get(guildId);
  if (!queue || queue.tracks.length === 0) return;

  const track = queue.tracks[0];
  try {
    const stream = getAudioStream(track.url);
    const resource = createAudioResource(stream, { inputType: StreamType.Arbitrary });

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
