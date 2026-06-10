---
name: Discord voice encryption library
description: Why @discordjs/voice "operation was aborted" on cloud hosts, and the fix
---

# @discordjs/voice encryption on cloud hosts (Railway etc.)

**Symptom:** `/play` fails with "The operation was aborted" — this is `entersState(connection, VoiceConnectionStatus.Ready, timeout)` timing out because the voice handshake never completes.

**Root cause:** As of late 2024 Discord requires the newer AEAD voice encryption modes (`aead_xchacha20poly1305_rtpsize` / `aead_aes256_gcm_rtpsize`). `@discordjs/voice` 0.18 discovers an encryption lib by dynamic-importing, in order: `sodium-native`, `sodium`, `libsodium-wrappers`, `@stablelib/xchacha20poly1305`, `@noble/ciphers/chacha`. **`tweetnacl` is NOT in that list** and does nothing. If none import, encryption falls back to a thrown error and the connection never reaches Ready.

`sodium-native` is a native module; its prebuilt binary can fail to load on a given cloud host, leaving no working lib.

**Fix:** add `libsodium-wrappers` (pure WASM, no native build) to the bot package's `dependencies`. It's a guaranteed fallback that works on any host. Keep `sodium-native` (faster when it loads); the discovery loop falls through to libsodium-wrappers if sodium-native fails.

**Why:** WASM needs no compilation/prebuilt binary, so it can't fail to load due to host environment mismatch.

**How to apply / verify:** run `node -e "import('@discordjs/voice').then(v=>console.log(v.generateDependencyReport()))"` inside the artifact dir — the "Encryption Libraries" section must show at least one loaded lib besides a possibly-broken sodium-native. Also note: cloud hosts must allow outbound UDP for voice; if UDP is blocked the same "operation was aborted" appears even with encryption working.
