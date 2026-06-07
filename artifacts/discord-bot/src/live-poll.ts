import { Client, EmbedBuilder, TextChannel } from "discord.js";
import { getAllStreamerLinks } from "./db.js";

const STREAM_ALERT_CHANNEL_ID = "1513110104482779276";
const POLL_INTERVAL_MS = 60_000; // check every 60 seconds

// Track who is currently live so we don't re-announce
const currentlyLive = new Set<string>(); // "guildId:userId"

// --- Platform checkers ---

async function isYouTubeLive(url: string): Promise<boolean> {
  try {
    const liveUrl = url.replace(/\/?$/, "/live");
    const res = await fetch(liveUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
    const text = await res.text();
    // YouTube embeds JSON-LD with isLiveBroadcast when the channel is actively live
    return text.includes('"isLiveBroadcast"') && !text.includes('"isLiveBroadcast":false');
  } catch {
    return false;
  }
}

async function isTwitchLive(url: string): Promise<boolean> {
  try {
    const match = url.match(/twitch\.tv\/([^/?#]+)/i);
    if (!match) return false;
    const login = match[1].toLowerCase();

    // Twitch's own public GQL endpoint — no credentials needed
    const res = await fetch("https://gql.twitch.tv/gql", {
      method: "POST",
      headers: {
        "Client-ID": "kimne78kx3ncx6brgo4mv6wki5h1ko",
        "Content-Type": "application/json",
      },
      body: JSON.stringify([{ query: `{user(login:"${login}"){stream{id}}}` }]),
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await res.json()) as any[];
    return data[0]?.data?.user?.stream?.id != null;
  } catch {
    return false;
  }
}

async function checkIsLive(platform: "youtube" | "twitch", url: string): Promise<boolean> {
  return platform === "youtube" ? isYouTubeLive(url) : isTwitchLive(url);
}

// --- Announcement builder (mirrors /golive embed) ---

async function postGoLiveAlert(
  client: Client,
  guildId: string,
  userId: string,
  platform: "youtube" | "twitch",
  url: string
) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;

  const alertChannel = guild.channels.cache.get(STREAM_ALERT_CHANNEL_ID) as TextChannel | undefined;
  if (!alertChannel) return;

  let member;
  try {
    member = await guild.members.fetch(userId);
  } catch {
    return; // member left the server
  }

  const platformLabel = platform === "youtube" ? "YouTube 🎬" : "Twitch 🟣";
  const platformColor = platform === "youtube" ? 0xff0000 : 0x9146ff;
  const displayName = member.displayName;

  const embed = new EmbedBuilder()
    .setColor(platformColor)
    .setTitle(`🔴 ${displayName} is now LIVE!`)
    .setDescription(
      `**${displayName}** just went live on ${platformLabel}!\n\n🔗 **Watch here:** ${url}`
    )
    .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
    .setFooter({ text: "Come watch and show some support!" })
    .setTimestamp();

  await alertChannel.send({ content: "@everyone", embeds: [embed] });
}

// --- Main poll loop ---

async function pollOnce(client: Client) {
  const links = getAllStreamerLinks();

  await Promise.allSettled(
    links.map(async ({ guild_id, user_id, platform, url }) => {
      const key = `${guild_id}:${user_id}`;
      const live = await checkIsLive(platform, url);

      if (live && !currentlyLive.has(key)) {
        // Just went live — announce and mark as live
        currentlyLive.add(key);
        await postGoLiveAlert(client, guild_id, user_id, platform, url);
      } else if (!live && currentlyLive.has(key)) {
        // Stream ended — clear the flag so next session triggers a new alert
        currentlyLive.delete(key);
      }
    })
  );
}

export function startLivePoll(client: Client) {
  // Stagger the first poll by 30s so the bot is fully ready
  setTimeout(() => {
    pollOnce(client).catch(() => {});
    setInterval(() => {
      pollOnce(client).catch(() => {});
    }, POLL_INTERVAL_MS);
  }, 30_000);
}
