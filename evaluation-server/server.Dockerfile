FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY evaluator ./evaluator
COPY evaluation-server ./evaluation-server
RUN npm run build:evaluation-server

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends docker.io \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/evaluation-server/dist/server.cjs ./evaluation-server/dist/server.cjs
COPY --from=build /app/evaluation-server/corpus ./evaluation-server/corpus
EXPOSE 3002
CMD ["node", "evaluation-server/dist/server.cjs"]
