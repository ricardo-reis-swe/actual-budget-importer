FROM node:24-bookworm-slim AS build

RUN corepack enable \
  && apt-get update \
  && apt-get install --yes --no-install-recommends build-essential python3 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . ./
RUN pnpm run build

FROM node:24-bookworm-slim

ENV APP_DATA_DIRECTORY=/data \
  APP_PORT=3000 \
  NODE_ENV=production

RUN groupadd --system app \
  && useradd --system --gid app --home-dir /app app \
  && mkdir /data \
  && chown app:app /data

WORKDIR /app

COPY --from=build --chown=app:app /app/package.json ./
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/src ./src
COPY --from=build --chown=app:app /app/dist ./dist

USER app

EXPOSE 3000

CMD ["./node_modules/.bin/tsx", "src/start-server.ts"]
