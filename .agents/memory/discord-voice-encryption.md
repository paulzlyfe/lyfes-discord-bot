---
name: Discord voice encryption library
description: Why @discordjs/voice "operation was aborted" on cloud hosts, and the fix
---

# @discordjs/voice encryption on cloud hosts (Railway etc.)

**Symptom:** `/play` fails with "The operation was aborted" — this is `entersState(connection, VoiceConnectionStatus.Ready, timeout)` timing out because the voice handshake never completes.

**Root cause:** As of late 2024 Discord requires the newer AEAD voice encryption modes (`aead_xchacha20poly1305_rtpsize` / `aead_aes256_gcm_rtpsize`). `@discordjs/voice` 0.18 discovers an encryption lib by dynamic-importing, in order: `sodium-native`, `sodium`, `libsodium-wrappers`, `@stablelib/xchacha20poly1305`, `@noble/ciphers/chacha`. **`tweetnacl` is NOT in that list** and does nothing. If none import, encryption falls back to a thrown error and the connection never reaches Ready.

`sodium-native` is a native module; its prebuilt binary can fail to load on a given cloud host, leaving no working lib.

**Fix (encryption):** add `libsodium-wrappers` (pure WASM, no native build) to the bot package's `dependencies`. It's a guaranteed fallback that works on any host. Keep `sodium-native` (faster when it loads); the discovery loop falls through to libsodium-wrappers if sodium-native fails.

**Fix (stuck at signalling — Railway/cloud):** the discord.js `client.voice.adapters` pipeline silently fails to deliver `VOICE_SERVER_UPDATE` to `@discordjs/voice` in some cloud environments. Symptoms: bot appears in the voice channel in Discord UI, but `entersState(Ready)` times out at `signalling` — no permissions error, shard is ready.

Root cause: `handlePacket` → `VOICE_SERVER_UPDATE.js` → `client.voice.adapters.get(guildId)?.onVoiceServerUpdate()` lookup returns undefined. `Events.Raw` fires BEFORE `handlePacket`, so a custom `DiscordGatewayAdapterCreator` that subscribes to `Events.Raw` directly receives the event exactly once, bypassing the broken adapter map.

Solution — replace `voiceAdapterCreator: voiceChannel.guild.voiceAdapterCreator` with a custom `buildVoiceAdapter(client, guild)` that:
- subscribes `client.on(Events.Raw, onRaw)` and calls `methods.onVoiceServerUpdate` / `methods.onVoiceStateUpdate` directly
- uses `(guild.shard as any).send(data)` for sendPayload
- calls `client.off(Events.Raw, onRaw)` on destroy

**Why:** `Events.Raw` is emitted in `WebSocketManager.attachEvents()` before `handlePacket`, guaranteeing exactly-once delivery without the fragile adapter map lookup.

**How to apply / verify:** Railway logs should show `[voice] ✓ VOICE_SERVER_UPDATE received` and `[voice] signalling → connecting → ready` after the fix.
