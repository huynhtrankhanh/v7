FROM node:22-slim

# Install socat for TCP-to-STDIO proxying and git for cloning
RUN apt-get update && apt-get install -y git socat && rm -rf /var/lib/apt/lists/*

# Clone Stripped Plover (do NOT include its code in this repo)
RUN git clone https://github.com/huynhtrankhanh/strippedplover.git /app

WORKDIR /app
RUN npm install && npm run build

# Create data directory for SQLite persistence
RUN mkdir -p /data

EXPOSE 4242

# Use socat to bridge TCP connections to the Stripped Plover STDIO process.
# Each new TCP connection spawns a fresh node process sharing the same SQLite DB.
CMD ["socat", "TCP-LISTEN:4242,reuseaddr,fork", "EXEC:node dist/index.js /data/plover.db"]
