FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY --chown=node:node src ./src
RUN mkdir -p /app/data && chown node:node /app/data

ENV DATA_DIR=/app/data

USER node
EXPOSE 10000

CMD ["npm", "start"]
