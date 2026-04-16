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

# Install dependencies
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

# Copy source and build
COPY . .
RUN npm run build

# Data directory (Railway Volume mounts here)
RUN mkdir -p /data/SharedAgents /data/PersonalAgents

EXPOSE 4888

CMD ["node", "dist/index.js"]
