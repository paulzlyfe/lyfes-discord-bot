---
name: YouTube audio streaming for Discord bot
description: Why the music bot streams via yt-dlp subprocess instead of JS libraries
---

**Rule:** Stream YouTube audio through the `yt-dlp` binary (installed as a Nix system dependency), piping stdout into `@discordjs/voice` with `StreamType.Arbitrary` (ffmpeg is on PATH). Keep `play-dl` only for search/metadata.

**Why:** As of July 2026, both `play-dl` (v1.9.7) and `@distube/ytdl-core` (v4.16.12) fail against YouTube's obfuscated player — "Could not parse decipher function", "No playable formats", and 403s from the datacenter IP. Cookies did not fix the JS-parsing failure. yt-dlp updates its extractor continuously and works from this server.

**How to apply:** Any YouTube download/stream feature should spawn `yt-dlp -f bestaudio -o -`. The user's `YOUTUBE_COOKIE` secret (raw cookie header) is converted at startup into a Netscape cookies.txt in a tmpdir and passed via `--cookies`. If streams start failing again, first try updating the yt-dlp Nix package.
