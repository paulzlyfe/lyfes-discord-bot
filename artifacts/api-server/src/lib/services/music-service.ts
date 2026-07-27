import { spawn, type ChildProcess } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  StreamType,
  entersState,
} from "@discordjs/voice";
import type { VoiceChannel, StageChannel, TextChannel } from "discord.js";
import playdl from "play-dl";
import { logger } from "../logger";
import type { TextBasedChannel } from "discord.js";

// ── Cookie file (Netscape format for yt-dlp) ────────────────────────────────
let cookieDir: string | null = null;

function buildCookieFile(): string | null {
  const raw = process.env["YOUTUBE_COOKIE"];
  if (!raw) return null;
  try {
    const lines = ["# Netscape HTTP Cookie File"];
    for (const pair of raw.split(";")) {
      const eq = pair.indexOf("=");
      if (eq === -1) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (!name) continue;
      lines.push(`.youtube.com\tTRUE\t/\tTRUE\t0\t${name}\t${value}`);
    }
    cookieDir = mkdtempSync(join(tmpdir(), "ytc-"));
    const file = join(cookieDir, "cookies.txt");
    writeFileSync(file, lines.join("\n") + "\n", { mode: 0o600 });
    return file;
  } catch (err) {
    logger.warn({ err }, "Failed to write YouTube cookie file — playing without auth");
    return null;
  }
}

const cookieFile = buildCookieFile();

function cleanupCookieFile(): void {
  if (cookieDir) {
    try { rmSync(cookieDir, { recursive: true, force: true }); } catch {}
    cookieDir = null;
  }
}
process.once("exit", cleanupCookieFile);
process.once("SIGTERM", () => { cleanupCookieFile(); process.exit(0); });

// ── Types & state ────────────────────────────────────────────────────────────
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
  currentProc: ChildProcess | null;
  advancing: boolean;
}

const states = new Map<string, GuildMusicState>();

function createState(): GuildMusicState {
  return {
    queue: [],
    currentSong: null,
    player: createAudioPlayer(),
    connection: null,
    textChannel: null,
    currentProc: null,
    advancing: false,
  };
}

function killProc(state: GuildMusicState): void {
  if (state.currentProc && state.currentProc.exitCode === null && !state.currentProc.killed) {
    try { state.currentProc.kill("SIGKILL"); } catch {}
  }
  state.currentProc = null;
}

function teardown(guildId: string): void {
  const state = states.get(guildId);
  if (!state) return;
  killProc(state);
  state.queue = [];
  state.currentSong = null;
  try { state.player.stop(true); } catch {}
  try { state.connection?.destroy(); } catch {}
  state.connection = null;
  states.delete(guildId);
}

// ── Streaming via yt-dlp ─────────────────────────────────────────────────────
// Prefer the up-to-date standalone binary in ./bin (downloaded from GitHub
// releases); the Nix-installed yt-dlp is too old for current YouTube.
const YTDLP_BIN = existsSync(join(process.cwd(), "bin", "yt-dlp"))
  ? join(process.cwd(), "bin", "yt-dlp")
  : "yt-dlp";

function getStream(url: string): { stream: Readable; proc: ChildProcess } {
  const args = [
    "-f", "bestaudio/best",
    "-o", "-",
    "--no-playlist",
    "--quiet",
    "--no-warnings",
    // Node solves YouTube's JS signature challenges (EJS)
    "--js-runtimes", "node",
    ...(cookieFile ? ["--cookies", cookieFile] : []),
    url,
  ];
  const proc = spawn(YTDLP_BIN, args, { stdio: ["ignore", "pipe", "pipe"] });

  let stderr = "";
  proc.stderr!.on("data", (d: Buffer) => { stderr += d.toString(); });
  proc.on("close", (code) => {
    if (code !== 0 && code !== null) {
      logger.error({ code, stderr: stderr.slice(0, 500) }, "yt-dlp exited with error");
    }
  });
  proc.on("error", (err) => logger.error({ err }, "yt-dlp spawn error"));

  return { stream: proc.stdout as Readable, proc };
}

// ── Queue advancement (serialized per guild) ─────────────────────────────────
async function playNext(guildId: string): Promise<void> {
  const state = states.get(guildId);
  if (!state || state.advancing) return;
  state.advancing = true;

  try {
    killProc(state); // terminate previous track's yt-dlp, if any

    const next = state.queue.shift();
    if (!next) {
      teardown(guildId);
      return;
    }

    state.currentSong = next;

    try {
      const { stream, proc } = getStream(next.url);
      state.currentProc = proc;
      const resource = createAudioResource(stream, { inputType: StreamType.Arbitrary });
      state.player.play(resource);
    } catch (err) {
      logger.error({ err, song: next.title }, "Failed to stream song, skipping");
      state.advancing = false;
      await playNext(guildId);
      return;
    }

    // Announcement is best-effort — never let a send failure affect playback
    if (state.textChannel?.isTextBased()) {
      (state.textChannel as TextChannel)
        .send(`▶ Now playing: **${next.title}**`)
        .catch(() => {});
    }
  } finally {
    const s = states.get(guildId);
    if (s) s.advancing = false;
  }
}

// ── Public service ───────────────────────────────────────────────────────────
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
      let url = query;
      let title = query;

      const isUrl = /^https?:\/\//.test(query);
      if (isUrl) {
        try {
          const info = await playdl.video_info(url);
          title = info.video_details?.title ?? query;
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

        // Single advancement path: only Idle advances the queue.
        // (The player emits Idle after errors too, so no advance in the error handler.)
        state.player.on(AudioPlayerStatus.Idle, () => {
          playNext(guildId).catch((err) =>
            logger.error({ err }, "Error advancing queue"),
          );
        });

        state.player.on("error", (err) => {
          logger.error({ err }, "Audio player error");
        });

        connection.on(VoiceConnectionStatus.Disconnected, async () => {
          try {
            await entersState(connection, VoiceConnectionStatus.Ready, 5_000);
          } catch {
            teardown(guildId);
          }
        });

        try {
          await entersState(connection, VoiceConnectionStatus.Ready, 10_000);
        } catch {
          teardown(guildId);
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
      teardown(guildId);
    },

    skip(guildId: string): boolean {
      const state = states.get(guildId);
      if (!state?.currentSong) return false;
      // Stopping the player triggers Idle → playNext, which kills the old proc
      state.player.stop();
      return true;
    },
  };
}
