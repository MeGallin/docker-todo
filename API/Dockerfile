FROM node:22-bookworm-slim AS dependencies

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package*.json ./
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules

COPY --chown=node:node src ./src
RUN mkdir -p /app/data && chown node:node /app/data

ENV DATA_DIR=/app/data

USER node
EXPOSE 10000

CMD ["npm", "start"]
