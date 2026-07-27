import { Router, type IRouter, type Request, type Response } from "express";
import crypto from "node:crypto";
import { postPushToChannels } from "../lib/discord-bot";

const router: IRouter = Router();

const GITHUB_WEBHOOK_SECRET = process.env["GITHUB_WEBHOOK_SECRET"];

function verifySignature(rawBody: Buffer, signatureHeader: string): boolean {
  if (!GITHUB_WEBHOOK_SECRET) return false;
  const expected = `sha256=${crypto
    .createHmac("sha256", GITHUB_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex")}`;
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signatureHeader),
      Buffer.from(expected),
    );
  } catch {
    return false;
  }
}

interface GitHubCommit {
  id: string;
  message: string;
  url: string;
  author: { name: string };
}

interface GitHubPushPayload {
  ref: string;
  compare: string;
  commits: GitHubCommit[];
  repository: {
    full_name: string;
    html_url: string;
  };
  pusher: { name: string };
  head_commit: GitHubCommit | null;
}

router.post("/webhooks/github", async (req: Request, res: Response): Promise<void> => {
  const signature = req.headers["x-hub-signature-256"];
  const event = req.headers["x-github-event"];

  if (!signature || typeof signature !== "string") {
    res.status(400).json({ error: "Missing signature" });
    return;
  }

  const rawBody = req.body as Buffer;
  if (!verifySignature(rawBody, signature)) {
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  // Acknowledge immediately
  res.status(200).json({ ok: true });

  if (event !== "push") return;

  let payload: GitHubPushPayload;
  try {
    payload = JSON.parse(rawBody.toString("utf8")) as GitHubPushPayload;
  } catch {
    return;
  }

  const { ref, compare, commits, repository, pusher } = payload;

  if (!commits || commits.length === 0) return;

  const branch = ref.replace("refs/heads/", "");
  const repoName = repository.full_name;
  const repoUrl = repository.html_url;

  // Build commit list — cap at 10 to avoid embed overflow
  const displayCommits = commits.slice(0, 10);
  const commitLines = displayCommits.map((c) => {
    const short = c.id.slice(0, 7);
    const message = c.message.split("\n")[0]; // first line only
    const truncated = message.length > 72 ? `${message.slice(0, 69)}...` : message;
    return `[\`${short}\`](${c.url}) ${truncated} — **${c.author.name}**`;
  });

  if (commits.length > 10) {
    commitLines.push(`*…and ${commits.length - 10} more commits*`);
  }

  const embed = {
    color: 0x24292f,
    author: {
      name: `${pusher.name} pushed to ${repoName}`,
      url: repoUrl,
      icon_url: `https://github.com/${pusher.name}.png`,
    },
    title: `🔀 ${commits.length} commit${commits.length !== 1 ? "s" : ""} to \`${branch}\``,
    url: compare,
    description: commitLines.join("\n"),
    footer: { text: repoName },
    timestamp: new Date().toISOString(),
  };

  await postPushToChannels(embed);
});

export default router;
