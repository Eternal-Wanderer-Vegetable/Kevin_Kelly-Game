# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY test ./test

RUN npm run typecheck && npm run build

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder --chown=node:node /app/dist ./dist

RUN mkdir -p /app/data /app/experiments \
  && chown -R node:node /app/data /app/experiments

USER node

ENTRYPOINT ["node", "dist/scripts/harness.js"]

FROM runtime AS runtime-python

USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv \
  && rm -rf /var/lib/apt/lists/*

USER node
