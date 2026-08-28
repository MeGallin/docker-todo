FROM node:22-bookworm-slim AS client-build

WORKDIR /client
COPY Client/package*.json ./
RUN npm ci
COPY Client/ ./
RUN npm run build

FROM node:22-bookworm-slim AS api-dependencies

WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY API/package*.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim

ENV NODE_ENV=production
ENV DATA_DIR=/app/data
WORKDIR /app

COPY API/package*.json ./
COPY --from=api-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node API/src ./src
COPY --from=client-build --chown=node:node /client/dist ./public

RUN mkdir -p /app/data && chown node:node /app/data

USER node
EXPOSE 10000

CMD ["npm", "start"]
