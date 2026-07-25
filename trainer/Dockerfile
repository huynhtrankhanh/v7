FROM node:24-bookworm-slim AS webui

WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.jest.json vite.config.ts ./
RUN npm ci
COPY src ./src
COPY static ./static
RUN npm run build

FROM node:24-bookworm-slim

WORKDIR /app/trainer
COPY trainer/package.json ./
COPY trainer/src ./src
COPY trainer/public ./public
COPY --from=webui /app/static /app/static

RUN mkdir -p /data && chown -R node:node /data /app/trainer
USER node

ENV HOST=0.0.0.0
ENV PORT=3001
ENV V7_TRAINER_DB=/data/trainer.sqlite3
EXPOSE 3001

CMD ["npm", "start"]
