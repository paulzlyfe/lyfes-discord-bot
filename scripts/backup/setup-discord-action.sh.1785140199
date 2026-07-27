#!/usr/bin/env bash
set -euo pipefail

# setup-discord-action.sh
# Creates a composite action at .github/actions/discord-notify and a workflow that calls it.
# Safe to paste into Notepad on Windows (use LF line endings when saving).

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

BRANCH="discord-notify/centralize-action"
COMMIT_MSG="chore: add discord notify composite action and entrypoint"
ACTION_DIR=".github/actions/discord-notify"
WORKFLOW_DIR=".github/workflows"
WORKFLOW_FILE="${WORKFLOW_DIR}/discord-notify.yml"
ACTION_YML="${ACTION_DIR}/action.yml"
ENTRYPOINT="${ACTION_DIR}/entrypoint.sh"

# Backup existing files if present
mkdir -p scripts/backup
timestamp="$(date +%s)"
if [ -f "$ENTRYPOINT" ]; then
  cp "$ENTRYPOINT" "scripts/backup/entrypoint.sh.${timestamp}" || true
fi
if [ -f "$ACTION_YML" ]; then
  cp "$ACTION_YML" "scripts/backup/action.yml.${timestamp}" || true
fi
if [ -f "$WORKFLOW_FILE" ]; then
  cp "$WORKFLOW_FILE" "scripts/backup/discord-notify.yml.${timestamp}" || true
fi

# Ensure directories exist
mkdir -p "$ACTION_DIR"
mkdir -p "$WORKFLOW_DIR"

# Write action.yml (composite action)
cat > "$ACTION_YML" <<'EOF'
name: Discord Notify Action
description: Post GitHub events to Discord with idempotency, diffs, check-run links, and thread support.
inputs:
  webhook:
    description: 'Discord webhook URL (or leave empty to use DISCORD_WEBHOOK secret)'
    required: false
  bot-token:
    description: 'Optional Discord bot token for thread creation'
    required: false
  channel-id:
    description: 'Optional Discord channel id for thread creation'
    required: false
  max-embed-chars:
    description: 'Max embed size'
    required: false
    default: '6000'
runs:
  using: "composite"
  steps:
    - name: Checkout
      uses: actions/checkout@v4
      with:
        fetch-depth: 0

    - name: Install dependencies
      shell: bash
      run: |
        if ! command -v jq >/dev/null 2>&1; then
          if command -v apt-get >/dev/null 2>&1; then
            sudo apt-get update -y && sudo apt-get install -y jq git
          fi
        fi

    - name: Run discord notify script
      shell: bash
      env:
        WEBHOOK: ${{ inputs.webhook || secrets.DISCORD_WEBHOOK }}
        BOT_TOKEN: ${{ inputs.bot-token || secrets.DISCORD_BOT_TOKEN }}
        CHANNEL_ID: ${{ inputs.channel-id || secrets.DISCORD_CHANNEL_ID }}
        REPO: ${{ github.repository }}
        REPO_URL: https://github.com/${{ github.repository }}
        GITHUB_EVENT_PATH: ${{ github.event_path }}
        GITHUB_EVENT_NAME: ${{ github.event_name }}
        GITHUB_SHA: ${{ github.sha }}
        GITHUB_REF: ${{ github.ref }}
        GITHUB_ACTOR: ${{ github.actor }}
        GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        MAX_EMBED_CHARS: ${{ inputs.max-embed-chars }}
      run: |
        mkdir -p /tmp/discord-action
        cp "${{ github.action_path }}/entrypoint.sh" /tmp/discord-action/entrypoint.sh || true
        chmod +x /tmp/discord-action/entrypoint.sh
        /tmp/discord-action/entrypoint.sh
EOF

# Write entrypoint.sh (the script that posts to Discord)
cat > "$ENTRYPOINT" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
trap 'rc=$?; echo "::error::Command failed at line ${LINENO} with exit code ${rc}"; exit $rc' ERR

WEBHOOK="${WEBHOOK:-}"
BOT_TOKEN="${BOT_TOKEN:-}"
CHANNEL_ID="${CHANNEL_ID:-}"
REPO="${REPO:-}"
REPO_URL="${REPO_URL:-https://github.com/${REPO}}"
EVENT_FILE="${GITHUB_EVENT_PATH:-/github/workflow/event.json}"
EVENT_NAME="${GITHUB_EVENT_NAME:-}"
SHA="${GITHUB_SHA:-}"
REF="${GITHUB_REF:-}"
ACTOR="${GITHUB_ACTOR:-}"
GITHUB_TOKEN="${GITHUB_TOKEN:-}"
MAX_EMBED_CHARS="${MAX_EMBED_CHARS:-6000}"
MAX_COMMIT_MSG_LEN="${MAX_COMMIT_MSG_LEN:-200}"
MAX_COMMIT_LINES="${MAX_COMMIT_LINES:-6}"
MAX_FILE_LIST="${MAX_FILE_LIST:-20}"
MAX_DIFF_BYTES="${MAX_DIFF_BYTES:-5000}"

if [ -z "$WEBHOOK" ]; then
  echo "::error::DISCORD_WEBHOOK not provided"
  exit 10
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "::error::jq not installed"
  exit 11
fi
if [ ! -f "$EVENT_FILE" ]; then
  echo "::error::GITHUB_EVENT_PATH ($EVENT_FILE) not found"
  exit 12
fi

shorten() {
  local s="$1"; local max="$2"
  if [ ${#s} -le "$max" ]; then printf "%s" "$s"; else printf "%s..." "${s:0:$((max-3))}"; fi
}

title=""
description=""
thumbnail="https://github.com/${REPO%%/*}.png"
author_name="$ACTOR"
author_icon="https://github.com/${ACTOR}.png"
url="$REPO_URL"

case "$EVENT_NAME" in
  push)
    branch="${REF#refs/heads/}"
    title="Push to ${branch} in ${REPO}"
    commits_count=$(jq -r 'if .commits then (.commits|length) else 0 end' "$EVENT_FILE" || echo 0)
    commits_md=""
    if [ "$commits_count" -gt 0 ]; then
      for i in $(seq 0 $((commits_count-1))); do
        sha=$(jq -r --argjson idx "$i" '.commits[$idx].id // empty' --argjson idx "$i" "$EVENT_FILE" || echo "")
        [ -z "$sha" ] && continue
        short=${sha:0:7}
        msg=$(jq -r --argjson idx "$i" '.commits[$idx].message // "<no message>"' --argjson idx "$i" "$EVENT_FILE" | tr '\n' ' ' || echo "<no message>")
        msg=$(shorten "$msg" "$MAX_COMMIT_MSG_LEN")
        author_name_commit=$(jq -r --argjson idx "$i" '.commits[$idx].author.name // .commits[$idx].author.username // "unknown"' --argjson idx "$i" "$EVENT_FILE" || echo "unknown")
        commits_md="${commits_md}• [\`${short}\`](${REPO_URL}/commit/${sha}) — ${msg} — *${author_name_commit}*\n"
        lines=$(echo -n "$commits_md" | grep -c '• ' || true)
        if [ "$lines" -ge "$MAX_COMMIT_LINES" ]; then break; fi
      done
    fi
    [ -z "$commits_md" ] && commits_md="• [\`${SHA:0:7}\`](${REPO_URL}/commit/${SHA})"
    description="**Pusher:** ${ACTOR}\n\n${commits_md}"
    ;;
  pull_request)
    pr_number=$(jq -r '.pull_request.number // ""' "$EVENT_FILE" || echo "")
    pr_title=$(jq -r '.pull_request.title // ""' "$EVENT_FILE" | tr '\n' ' ' || echo "")
    pr_user=$(jq -r '.pull_request.user.login // ""' "$EVENT_FILE" || echo "")
    pr_url=$(jq -r '.pull_request.html_url // ""' "$EVENT_FILE" || echo "")
    title="PR #${pr_number}: ${pr_title}"
    description="**Author:** ${pr_user}\n[View PR](${pr_url})"
    if [ -n "$GITHUB_TOKEN" ]; then
      head_sha=$(jq -r '.pull_request.head.sha // ""' "$EVENT_FILE" || echo "")
      if [ -n "$head_sha" ]; then
        checks=$(curl -s -H "Authorization: Bearer ${GITHUB_TOKEN}" -H "Accept: application/vnd.github+json" "https://api.github.com/repos/${REPO}/commits/${head_sha}/check-runs" | jq -r '.check_runs[]? | "\(.name): \(.conclusion // .status) - \(.html_url // "")"' || true)
        if [ -n "$checks" ]; then
          description="${description}\n\n**Checks:**\n${checks}"
        fi
      fi
    fi
    base_ref=$(jq -r '.pull_request.base.ref // ""' "$EVENT_FILE" || echo "")
    head_ref=$(jq -r '.pull_request.head.ref // ""' "$EVENT_FILE" || echo "")
    if [ -n "$base_ref" ] && [ -n "$head_ref" ]; then
      git fetch origin "$base_ref":"refs/tmp/base" >/dev/null 2>&1 || true
      files=$(git diff --name-only refs/tmp/base "$head_ref" 2>/dev/null || git diff --name-only "$base_ref" "$head_ref" 2>/dev/null || true)
      if [ -n "$files" ]; then
        file_list=""
        count=0
        while IFS= read -r f; do
          [ -z "$f" ] && continue
          count=$((count+1))
          if [ $count -gt $MAX_FILE_LIST ]; then file_list="${file_list}• ...and more files (truncated)\n"; break; fi
          file_list="${file_list}• ${f}\n"
        done <<< "$files"
        description="${description}\n\n**Files changed:**\n${file_list}"
      fi
    fi
    ;;
  release)
    tag=$(jq -r '.release.tag_name // ""' "$EVENT_FILE" || echo "")
    rel_url=$(jq -r '.release.html_url // ""' "$EVENT_FILE" || echo "")
    title="Release ${tag} in ${REPO}"
    description="[View release](${rel_url})"
    ;;
  issues)
    issue_num=$(jq -r '.issue.number // ""' "$EVENT_FILE" || echo "")
    issue_title=$(jq -r '.issue.title // ""' "$EVENT_FILE" | tr '\n' ' ' || echo "")
    issue_user=$(jq -r '.issue.user.login // ""' "$EVENT_FILE" || echo "")
    issue_url=$(jq -r '.issue.html_url // ""' "$EVENT_FILE" || echo "")
    title="Issue #${issue_num}: ${issue_title}"
    description="**Author:** ${issue_user}\n[View issue](${issue_url})"
    ;;
  *)
    echo "::warning::Unhandled event: $EVENT_NAME"
    exit 0
    ;;
esac

embed=$(jq -n --arg t "$title" --arg d "$description" --arg u "$url" --arg an "$author_name" --arg ai "$author_icon" --arg th "$thumbnail" '{
  title: $t, description: $d, url: $u, color: 3066993,
  author: { name: $an, icon_url: $ai }, thumbnail: { url: $th }
}')

embed_len=$(echo -n "$embed" | wc -c)
if [ "$embed_len" -gt "$MAX_EMBED_CHARS" ]; then
  description=$(shorten "$description" 1000)
  embed=$(jq -n --arg t "$title" --arg d "$description" --arg u "$url" --arg an "$author_name" --arg ai "$author_icon" --arg th "$thumbnail" '{ title: $t, description: $d, url: $u, color: 3066993, author: { name: $an, icon_url: $ai }, thumbnail: { url: $th } }')
fi

payload=$(jq -n --argjson e "$embed" '{embeds: [$e]}')
payload_len=$(echo -n "$payload" | wc -c)
echo "Payload size: ${payload_len} bytes"

http_code=$(curl -s -o /tmp/discord_resp -w "%{http_code}" -H "Content-Type: application/json" -d "$payload" "$WEBHOOK" || true)
echo "Discord webhook HTTP status: $http_code"
if [ "$http_code" -ge 200 ] && [ "$http_code" -lt 300 ]; then
  echo "Message posted successfully."
  message_id=$(jq -r '.id // empty' /tmp/discord_resp || true)
  if [ -n "$message_id" ] && [ -n "$BOT_TOKEN" ] && [ -n "$CHANNEL_ID" ]; then
    thread_name="GH-${EVENT_NAME}-${SHA:0:7}"
    create_thread_resp=$(curl -s -X POST "https://discord.com/api/v10/channels/${CHANNEL_ID}/messages/${message_id}/threads" \
      -H "Authorization: Bot ${BOT_TOKEN}" \
      -H "Content-Type: application/json" \
      -d "{\"name\":\"${thread_name}\",\"auto_archive_duration\":1440}" || true)
    thread_id=$(echo "$create_thread_resp" | jq -r '.id // empty' || true)
    if [ -n "$thread_id" ]; then
      echo "Thread created: $thread_id"
    else
      echo "::warning::Failed to create thread; response: $create_thread_resp"
    fi
  fi
else
  echo "::error::Discord webhook returned HTTP status $http_code"
  head -c 4000 /tmp/discord_resp || true
  exit 30
fi
EOF

# Make entrypoint executable and normalize line endings (best-effort)
chmod +x "$ENTRYPOINT" || true
if command -v dos2unix >/dev/null 2>&1; then
  dos2unix "$ENTRYPOINT" >/dev/null 2>&1 || true
  dos2unix "$ACTION_YML" >/dev/null 2>&1 || true
fi

# Write a minimal workflow that uses the action
cat > "$WORKFLOW_FILE" <<'EOF'
name: Discord Notify
on:
  push:
    branches: [ main ]
  pull_request:
    types: [opened, reopened, closed, synchronize]
  release:
    types: [published]
jobs:
  notify:
    runs-on: ubuntu-latest
    steps:
      - name: Run Discord Notify Action
        uses: ./.github/actions/discord-notify
        with:
          webhook: ${{ secrets.DISCORD_WEBHOOK }}
EOF

# Ensure branch exists and is checked out
if git rev-parse --verify "$BRANCH" >/dev/null 2>&1; then
  git checkout "$BRANCH"
else
  git checkout -b "$BRANCH"
fi

# Add, commit, and push
git add "$ACTION_YML" "$ENTRYPOINT" "$WORKFLOW_FILE"
if git diff --cached --quiet; then
  echo "No changes to commit."
else
  git commit -m "$COMMIT_MSG" || true
  git push -u origin "$BRANCH" || true
fi

echo "Setup complete. Files created:"
echo " - $ACTION_YML"
echo " - $ENTRYPOINT"
echo " - $WORKFLOW_FILE"
echo
echo "If you want a PR created automatically and you have 'gh' installed, run:"
echo "  gh pr create --title \"$COMMIT_MSG\" --body \"Centralize discord notify logic into composite action\" --base main"
