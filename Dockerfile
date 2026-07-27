# ── Build stage ────────────────────────────────────────────────────────────────
FROM node:24-slim AS builder

# Install pnpm + system build tools
RUN npm install -g pnpm@10 && \
    apt-get update -qq && \
    apt-get install -y --no-install-recommends git python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy manifests first for better layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.base.json tsconfig.json ./
COPY lib/db/package.json lib/db/
COPY lib/api-zod/package.json lib/api-zod/
COPY lib/api-client-react/package.json lib/api-client-react/
COPY lib/api-spec/package.json lib/api-spec/
COPY artifacts/api-server/package.json artifacts/api-server/

# Install all workspace dependencies
RUN pnpm install --frozen-lockfile --ignore-scripts

# Copy full source
COPY lib/ lib/
COPY artifacts/api-server/ artifacts/api-server/

# Build shared libs then the api-server
RUN pnpm run typecheck:libs && \
    pnpm --filter @workspace/api-server run build

# ── Runtime stage ──────────────────────────────────────────────────────────────
FROM node:24-slim AS runtime

# ffmpeg  — required by @discordjs/voice for audio transcoding
# curl    — used during yt-dlp download below
# ca-certificates — TLS
RUN apt-get update -qq && \
    apt-get install -y --no-install-recommends ffmpeg curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Download latest yt-dlp binary
RUN curl -sL -o /usr/local/bin/yt-dlp \
      "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux" && \
    chmod +x /usr/local/bin/yt-dlp && \
    yt-dlp --version

RUN npm install -g pnpm@10

WORKDIR /app

# Copy lockfile + workspace manifests so pnpm can link packages at runtime
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY lib/db/package.json lib/db/
COPY lib/api-zod/package.json lib/api-zod/
COPY artifacts/api-server/package.json artifacts/api-server/

# Production deps only
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

# Copy built output from builder
COPY --from=builder /app/artifacts/api-server/dist ./artifacts/api-server/dist
COPY --from=builder /app/lib/db/dist ./lib/db/dist 2>/dev/null || true
COPY --from=builder /app/lib/api-zod/dist ./lib/api-zod/dist 2>/dev/null || true

WORKDIR /app/artifacts/api-server

ENV NODE_ENV=production

EXPOSE 8080

CMD ["node", "--enable-source-maps", "./dist/index.mjs"]
