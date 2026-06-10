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
import type { DiscordGatewayAdapterCreator } from "@discordjs/voice";
import { Client, Events, Guild, GuildMember, TextChannel, VoiceChannel } from "discord.js";
import { spawn, execFile } from "child_process";
import { promisify } from "util";
import { Readable } from "stream";

const execFileAsync = promisify(execFile);

/**
 * Hybrid voice adapter:
 *  - Uses guild.voiceAdapterCreator for reliable OP4 sending (guild.shard.send).
 *  - Deduplicates VOICE_SERVER_UPDATE by endpoint+token so configureNetworking() is
 *    not called twice from the raw+builtin dual-delivery paths, but NEW values on
 *    reconnect are always forwarded (unlike a simple once-guard which blocks them).
 *  - Also subscribes to client "raw" events as a backup delivery path in case
 *    client.voice.adapters lookup doesn't fire.
 *  - ORDERING FIX: if VOICE_SERVER_UPDATE arrives before VOICE_STATE_UPDATE,
 *    configureNetworking() exits early (state is null). We re-trigger it once per
 *    server-update after state is stored.
 */
function buildVoiceAdapter(client: Client, guild: Guild): DiscordGatewayAdapterCreator {
  return (methods) => {
    // Dedup VOICE_SERVER_UPDATE by endpoint+token; resets on new values (reconnect).
    const seenServerKeys = new Set<string>();
    let lastServerPacket: Parameters<typeof methods.onVoiceServerUpdate>[0] | null = null;
    // Allow exactly one ordering-fix re-trigger per server update.
    let retriggered = false;

    function handleServerUpdate(data: Parameters<typeof methods.onVoiceServerUpdate>[0]) {
      const key = `${data.endpoint}|${data.token}`;
      if (seenServerKeys.has(key)) return;
      seenServerKeys.add(key);
      lastServerPacket = data;
      retriggered = false; // new server packet — allow one re-trigger after state arrives
      console.log("[voice] ✓ VOICE_SERVER_UPDATE → addServerPacket (endpoint:", !!data.endpoint, ")");
      methods.onVoiceServerUpdate(data);
    }

    function handleStateUpdate(data: Parameters<typeof methods.onVoiceStateUpdate>[0]) {
      console.log("[voice] ✓ VOICE_STATE_UPDATE → addStatePacket (session:", data.session_id, ")");
      methods.onVoiceStateUpdate(data);
      // ORDERING FIX: if server arrived before state, configureNetworking() bailed because
      // state was null. Re-trigger it now that state is stored.
      if (lastServerPacket && !retriggered) {
        retriggered = true;
        console.log("[voice] Re-triggering configureNetworking (server arrived before state)");
        methods.onVoiceServerUpdate(lastServerPacket);
      }
    }

    // Use the built-in adapter so OP4 is sent via guild.shard (proven reliable)
    // and our handlers are registered in client.voice.adapters for normal delivery.
    const adapterMethods: typeof methods = {
      onVoiceServerUpdate: handleServerUpdate,
      onVoiceStateUpdate: handleStateUpdate,
      destroy: () => methods.destroy(),
    };
    const builtinAdapter = guild.voiceAdapterCreator(adapterMethods);

    // Also subscribe to raw events as a backup delivery path.
    // "raw" fires BEFORE handlePacket so this tends to win the race;
    // the endpoint+token dedup prevents double-processing if both paths fire.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function onRaw(packet: any) {
      const { t, d } = packet ?? {};
      if (!t || !d) return;
      if (t === "VOICE_SERVER_UPDATE" && d.guild_id === guild.id) {
        console.log("[voice] raw VOICE_SERVER_UPDATE — endpoint:", !!d.endpoint);
        handleServerUpdate(d as Parameters<typeof methods.onVoiceServerUpdate>[0]);
      } else if (t === "VOICE_STATE_UPDATE" && d.guild_id === guild.id && d.user_id === client.user?.id) {
        console.log("[voice] raw VOICE_STATE_UPDATE — channel:", d.channel_id, "session:", !!d.session_id);
        handleStateUpdate(d as Parameters<typeof methods.onVoiceStateUpdate>[0]);
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (client as any).on("raw", onRaw);

    return {
      sendPayload: (data) => {
        const ok = builtinAdapter.sendPayload(data);
        console.log(`[voice] sendPayload → ${ok ? "sent ✓" : "FAILED (shard not ready?)"}`);
        return ok;
      },
      destroy: () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (client as any).off("raw", onRaw);
        builtinAdapter.destroy();
      },
    };
  };
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

async function getVideoInfo(query: string): Promise<{ title: string; url: string }> {
  const isUrl = query.startsWith("http://") || query.startsWith("https://");
  const args = [
    "--no-playlist",
    "--print", "%(title)s\n%(webpage_url)s",
    "--quiet",
    isUrl ? query : `ytsearch1:${query}`,
  ];
  const { stdout } = await execFileAsync("yt-dlp", args, { timeout: 20_000 });
  const lines = stdout.trim().split("\n");
  return {
    title: lines[0] ?? "Unknown",
    url: lines[1] ?? query,
  };
}

function ytdlpStream(url: string): Readable {
  const proc = spawn("yt-dlp", [
    "-f", "bestaudio[ext=webm]/bestaudio/best",
    "--no-playlist",
    "-o", "-",
    "--quiet",
    url,
  ]);
  proc.stderr.on("data", (d: Buffer) => process.stderr.write(d));
  return proc.stdout as unknown as Readable;
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
    adapterCreator: buildVoiceAdapter(voiceChannel.guild.client, voiceChannel.guild),
    selfDeaf: false,
    selfMute: false,
  });

  // Track state transitions for diagnostics.
  let everReachedConnecting = false;
  const stateHistory: string[] = [];
  connection.on("stateChange", (oldState, newState) => {
    console.log(`[voice] ${oldState.status} → ${newState.status}`);
    stateHistory.push(newState.status);
    if (newState.status === VoiceConnectionStatus.Connecting) everReachedConnecting = true;
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
        "Check the Fly.io logs for '[voice]' lines to see what happened. " +
        "This may be a transient network issue — try again, or check if Discord's voice servers are reachable."
      );
    }
    throw new Error(
      `Voice connection stuck at signalling — Discord's VOICE_SERVER_UPDATE/VOICE_STATE_UPDATE never arrived. ` +
      "Check Fly.io logs for '[voice] raw VOICE_SERVER_UPDATE' and '[voice] sendPayload → sent ✓'."
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
    const stream = ytdlpStream(track.url);
    const resource = createAudioResource(stream, {
      inputType: StreamType.Arbitrary,
    });

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
