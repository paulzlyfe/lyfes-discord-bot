import type { Client, TextChannel } from "discord.js";
import { EmbedBuilder } from "discord.js";
import { db } from "@workspace/db";
import { streamerProfilesTable, guildSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../logger";

const TWITCH_CLIENT_ID = process.env["TWITCH_CLIENT_ID"];
const TWITCH_CLIENT_SECRET = process.env["TWITCH_CLIENT_SECRET"];
const YOUTUBE_API_KEY = process.env["YOUTUBE_API_KEY"];

let twitchToken: string | null = null;
let twitchTokenExpiry = 0;

async function getTwitchToken(): Promise<string | null> {
  if (!TWITCH_CLIENT_ID || !TWITCH_CLIENT_SECRET) return null;
  if (twitchToken && Date.now() < twitchTokenExpiry) return twitchToken;
  try {
    const res = await fetch(
      `https://id.twitch.tv/oauth2/token?client_id=${TWITCH_CLIENT_ID}&client_secret=${TWITCH_CLIENT_SECRET}&grant_type=client_credentials`,
      { method: "POST" },
    );
    const data = (await res.json()) as { access_token: string; expires_in: number };
    twitchToken = data.access_token;
    twitchTokenExpiry = Date.now() + data.expires_in * 1000 - 60000;
    return twitchToken;
  } catch { return null; }
}

async function isTwitchLive(username: string): Promise<boolean> {
  const token = await getTwitchToken();
  if (!token || !TWITCH_CLIENT_ID) return false;
  try {
    const res = await fetch(
      `https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(username)}`,
      { headers: { "Client-ID": TWITCH_CLIENT_ID, Authorization: `Bearer ${token}` } },
    );
    const data = (await res.json()) as { data: unknown[] };
    return data.data.length > 0;
  } catch { return false; }
}

async function isYoutubeLive(channelIdentifier: string): Promise<boolean> {
  if (!YOUTUBE_API_KEY) return false;
  try {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelIdentifier}&type=video&eventType=live&key=${YOUTUBE_API_KEY}`,
    );
    const data = (await res.json()) as { items: unknown[] };
    return (data.items?.length ?? 0) > 0;
  } catch { return false; }
}

export function startStreamingMonitor(client: Client): void {
  setInterval(async () => {
    try {
      const profiles = await db.select().from(streamerProfilesTable);
      for (const profile of profiles) {
        let live = false;
        if (profile.platform === "twitch") {
          live = await isTwitchLive(profile.channelIdentifier);
        } else if (profile.platform === "youtube") {
          live = await isYoutubeLive(profile.channelIdentifier);
        }

        const wasLive = profile.isLive === "true";
        if (live === wasLive) continue;

        await db
          .update(streamerProfilesTable)
          .set({ isLive: live ? "true" : "false" })
          .where(eq(streamerProfilesTable.userId, profile.userId));

        const [settings] = await db
          .select()
          .from(guildSettingsTable)
          .where(eq(guildSettingsTable.guildId, profile.guildId));

        const alertChannelId = settings?.liveAlertChannelId;
        if (!alertChannelId) continue;

        if (live) {
          // Just went live
          try {
            const ch = await client.channels.fetch(alertChannelId) as TextChannel;
            const user = await client.users.fetch(profile.userId).catch(() => null);
            const name = user?.displayName ?? "A streamer";
            const streamerRoleId = settings?.streamerRoleId;
            const mention = streamerRoleId ? `<@&${streamerRoleId}> ` : "";

            const embed = new EmbedBuilder()
              .setColor(0x9146ff)
              .setTitle(`${name} is LIVE!`)
              .setDescription(`Come watch at ${profile.channelUrl}`)
              .setTimestamp();

            if (user) embed.setThumbnail(user.displayAvatarURL());
            await ch.send({ content: `${mention}🔴 **${name}** is live!`, embeds: [embed] });
          } catch (err) {
            logger.error({ err }, "Failed to post auto live alert");
          }
        }
      }
    } catch (err) {
      logger.error({ err }, "Streaming monitor error");
    }
  }, 60_000);
}
