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

# Install ALL dependencies (need devDeps like typescript for the build step)
# Skip postinstall — it depends on scripts/ which isn't copied yet
COPY package*.json ./
RUN npm ci --ignore-scripts || npm install --ignore-scripts

# Copy source
COPY . .

# Run postinstall (installs nested MCP deps) and build (needs tsc from devDeps)
RUN npm run postinstall && npm run build

# Now prune dev dependencies to shrink the final image
RUN npm prune --omit=dev

# Data directory (Railway Volume mounts here)
RUN mkdir -p /data/SharedAgents /data/PersonalAgents

EXPOSE 4888

# Container deployments are server mode (hides local-only UI, uses API executor)
ENV MYAGENT_SERVER_MODE=true

CMD ["node", "dist/index.js"]
