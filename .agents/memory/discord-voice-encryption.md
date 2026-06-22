---
name: Discord voice encryption and connection issues
description: Voice close code 4017 root cause and fix; libsodium-wrappers requirement
---

# @discordjs/voice connection issues on cloud hosts

## Close code 4017 — VOICE_STATE_UPDATE double-delivery

**Symptom:** `/play` joins voice channel (Discord UI shows bot in channel), stays "thinking" forever, logs show infinite loop: `signalling → connecting → signalling` with `[voice-net-close] code=4017`.

**Root cause:** Both the custom `raw` event listener AND the builtin `guild.voiceAdapterCreator` adapter deliver `VOICE_STATE_UPDATE` to `handleStateUpdate`. This causes `configureNetworking()` to open two WebSocket connections simultaneously. Both try to IDENTIFY with the same session_id. Discord closes both with code 4017 (session conflict).

**Fix:** Add a `seenStateKeys = new Set<string>()` keyed on `${session_id}|${channel_id}` inside `buildVoiceAdapter`, exactly like the existing `seenServerKeys` dedup for `VOICE_SERVER_UPDATE`. Clear `seenStateKeys` in `resetForReconnect`. The raw listener always fires first (before `handlePacket`), so it wins the race; the builtin adapter's delivery is silently skipped.

**Why:** `events.Raw` fires before `handlePacket`. Both paths reach `handleStateUpdate`. Without dedup, two concurrent WebSocket sessions are opened for the same session_id → Discord code 4017.

**How to apply:** In `buildVoiceAdapter` in `music.ts`, ensure `seenStateKeys` is declared alongside `seenServerKeys` and cleared in `resetForReconnect`. The dedup check must be at the TOP of `handleStateUpdate` before calling `methods.onVoiceStateUpdate`.

---

## Encryption library — "operation was aborted"

**Symptom:** `entersState(Ready)` times out — voice handshake never completes.

**Root cause:** Discord requires AEAD voice encryption modes (`aead_xchacha20_poly1305_rtpsize` / `aead_aes256_gcm_rtpsize`). `tweetnacl` is NOT in @discordjs/voice 0.18's discovery list.

**Fix:** Add `libsodium-wrappers` (pure WASM, works on any host) to `dependencies`. Keep `sodium-native` as the faster option; the discovery loop falls through to libsodium-wrappers if sodium-native fails.

---

## Stuck at signalling — raw event adapter

**Symptom:** Bot appears in voice channel in Discord UI, but `entersState(Ready)` times out stuck at `signalling` — `VOICE_SERVER_UPDATE` never arrives via normal path.

**Root cause:** `client.voice.adapters.get(guildId)?.onVoiceServerUpdate()` lookup returns undefined on some cloud hosts.

**Fix:** Use custom `buildVoiceAdapter` that subscribes `client.on('raw', onRaw)` and calls methods directly, bypassing the adapter map lookup.
