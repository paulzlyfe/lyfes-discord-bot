FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    python3-pip \
    curl \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
    -o /usr/local/bin/yt-dlp && chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app

COPY artifacts/discord-bot/package.json ./
RUN sed -i 's/: "catalog:"/: "*"/g' package.json && \
    sed -i '/"sodium-native"/d' package.json

RUN npm install

COPY artifacts/discord-bot/src/ ./src/

CMD ["node", "--import", "tsx/esm", "src/index.ts"]
