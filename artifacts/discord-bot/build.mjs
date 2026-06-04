import { build } from "esbuild";

const shared = {
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  external: [
    "node:sqlite",
    "sodium-native",
    "@discordjs/opus",
    "libsodium-wrappers",
    "tweetnacl",
    "play-opus",
    "opusscript",
    "ffmpeg-static",
    "node-opus",
  ],
};

await build({ ...shared, entryPoints: ["src/index.ts"], outfile: "dist/index.mjs" });
await build({ ...shared, entryPoints: ["src/deploy-commands.ts"], outfile: "dist/deploy-commands.mjs" });

console.log("Build complete");
