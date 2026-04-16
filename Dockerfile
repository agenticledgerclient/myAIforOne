FROM node:22-slim

# Install system deps
RUN apt-get update && apt-get install -y \
    git \
    curl \
    ca-certificates \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# Install Claude CLI globally
RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app

# Install dependencies (skip postinstall — it depends on scripts/ which isn't copied yet)
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts || npm install --omit=dev --ignore-scripts

# Copy source
COPY . .

# Now run postinstall (installs nested MCP deps) and build
RUN npm run postinstall && npm run build

# Data directory (Railway Volume mounts here)
RUN mkdir -p /data/SharedAgents /data/PersonalAgents

EXPOSE 4888

CMD ["node", "dist/index.js"]
