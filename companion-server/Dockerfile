FROM node:20-slim

WORKDIR /app

# Install build dependencies for better-sqlite3
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ git \
    && rm -rf /var/lib/apt/lists/*

# Copy package files and install
COPY package.json package-lock.json ./
RUN npm ci --production

# Copy application source
COPY src/ src/

# Data volume for persistent database
VOLUME /data

# Environment configuration
ENV COMPANION_PORT=24842
ENV COMPANION_HOST=0.0.0.0
ENV COMPANION_DB_PATH=/data/companion.db

EXPOSE 24842

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://localhost:24842/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["node", "src/index.js"]
