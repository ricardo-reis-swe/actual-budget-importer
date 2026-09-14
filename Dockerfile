# syntax=docker/dockerfile:1

ARG NODE_IMAGE=node:24.21.0-bookworm-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553

FROM ${NODE_IMAGE} AS build

RUN corepack enable \
  && apt-get update \
  && apt-get install --yes --no-install-recommends build-essential python3 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=actual-budget-importer-pnpm,target=/root/.local/share/pnpm/store \
  pnpm install --frozen-lockfile

COPY index.html tsconfig.json vite.config.ts ./
COPY public ./public
COPY src ./src
RUN pnpm run build
RUN pnpm prune --prod

FROM ${NODE_IMAGE}

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

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.APP_PORT + '/api/health').then(response => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1));"]

CMD ["./node_modules/.bin/tsx", "src/start-server.ts"]
