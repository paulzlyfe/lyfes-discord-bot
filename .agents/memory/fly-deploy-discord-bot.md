---
name: Fly.io deploy for discord-bot
description: How to deploy the Discord bot to Fly.io app lyfe-moderation-bot, including builder and shell-timeout gotchas
---

# Deploying discord-bot to Fly.io

App: `lyfe-moderation-bot` (region `iad`). flyctl at `~/.fly/bin/flyctl` (install via `curl -L https://fly.io/install.sh | sh`). Needs `FLY_API_TOKEN` secret.

Deploy command (run from **workspace root**, not the artifact dir — the Dockerfile COPYs monorepo-root-relative paths like `artifacts/discord-bot/package.json`):
```
~/.fly/bin/flyctl deploy . --app lyfe-moderation-bot --dockerfile artifacts/discord-bot/Dockerfile --remote-only
```

**Why / gotchas:**
- There IS a `fly.toml` at the workspace root (not in the artifact dir).
- Use the **default depot builder**. Passing `--depot=false` (legacy remote builder) fails with `unauthorized` for this token type.
- Depot's first "Waiting for depot builder..." can cold-start for a couple minutes; the very first build attempt may stall — just retry.
- Builds exceed the 2-min bash limit. Run detached so the shell timeout doesn't kill it:
  `setsid bash -c '<deploy> > /tmp/flyd.log 2>&1' < /dev/null & disown` then poll `/tmp/flyd.log`.
- Do NOT use `pkill -f "flyctl deploy"` — the pattern matches your own polling shell and SIGKILLs it (exit 137). Find the PID via `ps -eo pid,args | grep [f]lyctl` and kill that, or just let it finish.
- Verify success: `flyctl status --app lyfe-moderation-bot` (version bumps, LAST UPDATED is today) and `flyctl logs --no-tail` shows `✅ Logged in as Lyfe's Moderation Bot#9431`.

**Local vs deployed:** the bot runs 24/7 on Fly. The local workflow guard exits unless `FLY_APP_NAME` or `ENABLE_LOCAL_BOT=1` is set, so the local workflow does NOT serve interactions. `deploy-commands.ts` only registers command *definitions* with Discord — it does not run the bot. If a slash command shows "The application did not respond", the registered command has no handler in the *running* (Fly) build → you need to deploy, not re-register.
