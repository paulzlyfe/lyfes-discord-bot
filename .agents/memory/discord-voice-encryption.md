---
name: Discord voice encryption and connection issues
description: Voice close code 4017 root cause and fix; custom adapter pitfalls; libsodium-wrappers requirement
---

# @discordjs/voice connection issues on cloud hosts

## Close code 4017 — two distinct causes, ruled out in order

**Symptom:** `/play` joins voice channel (Discord UI shows bot in channel), stays "thinking" forever, logs show infinite loop: `signalling → connecting → signalling`, networking sub-state `0 → 1 → 6` (OpeningWs → Identifying → Closed), then `[voice-net-close] code=4017`. The close happens right after IDENTIFY, BEFORE UDP/encryption negotiation.

### Cause 1 (ruled out): multiple bot instances on the same token
Phantom instances (leftover Fly/Railway/Replit deployments) all connect with the same token. Gateway events (interactions, VOICE_*) get split across instances, so the instance that holds the voice connection never sees the matching VOICE_SERVER_UPDATE, and sessions conflict.
- **Detection:** watch live logs on the real host (`docker logs -f lyfe-bot --since 1s`) and run `/play`. If Discord shows "thinking" but the host logs NOTHING, another instance is handling the interaction.
- **Definitive fix:** regenerate the bot token in the Discord Developer Portal. This disconnects every old instance instantly; only the host given the new token survives. Deleting Fly/Railway accounts does NOT reliably stop running containers.

### Cause 2 (the real code bug here): custom voice adapter reusing a stale server packet
A hand-rolled `buildVoiceAdapter` that cached `lastServerPacket` and re-fired `onVoiceServerUpdate` ("ordering fix: server arrived before state") reused the FIRST voice token on every reconnect. Discord rejects IDENTIFY with a new session + stale token → 4017 → loop. Telltale log: `Re-triggering configureNetworking (server arrived before state)` on EVERY cycle.

**Fix:** delete the custom adapter entirely. Use the built-in `guild.voiceAdapterCreator` (`adapterCreator: voiceChannel.guild.voiceAdapterCreator`). discord.js handles VOICE_STATE/SERVER ordering internally and always uses the fresh token Discord sends on each reconnect.

**Why:** the custom adapter (raw-event listener + dedup + re-trigger) was originally added to work around VOICE_SERVER_UPDATE "not arriving" — but that was a symptom of Cause 1 (multiple instances), not a real adapter-map problem. Once there is a single instance, the built-in adapter works. Do NOT reintroduce a custom adapter to "fix" missing voice events; check for phantom instances first.

**How to apply:** keep the diagnostic taps on the `connection` object (`stateChange`, and tapping `state.networking` for `[voice-net-close]` / `[voice-net-debug]` / `ws close`) — they are harmless and invaluable. Just never wrap or replace `guild.voiceAdapterCreator`.

---

## Encryption library — "operation was aborted" / Ready timeout

**Symptom:** `entersState(Ready)` times out — voice handshake reaches protocol selection then never completes (distinct from 4017, which closes earlier at IDENTIFY).

**Root cause:** Discord requires AEAD voice encryption modes (`aead_xchacha20_poly1305_rtpsize` / `aead_aes256_gcm_rtpsize`). `tweetnacl` is NOT in @discordjs/voice 0.18's discovery list.

**Fix:** keep `libsodium-wrappers` (pure WASM, works on any host) in `dependencies`. `sodium-native` is faster but is a native module that may fail to load in the Docker image; the discovery loop falls through to libsodium-wrappers when it does. Verify the runtime dependency report at startup actually shows a working AEAD lib — declared in package.json is not the same as loaded at runtime.
