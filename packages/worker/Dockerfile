FROM node:20-bookworm AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/worker/package.json packages/worker/
RUN npm ci --workspace=packages/shared --workspace=packages/worker
COPY tsconfig.base.json ./
COPY packages/shared/ packages/shared/
COPY packages/worker/ packages/worker/
RUN npm run build -w packages/shared && npm run build -w packages/worker

FROM node:20-bookworm-slim
# Install Docker CLI (for spawning sandbox containers)
RUN apt-get update && apt-get install -y docker.io && rm -rf /var/lib/apt/lists/*
# gosu for dropping privileges after fixing permissions (Debian equivalent of su-exec)
RUN apt-get update && apt-get install -y gosu && rm -rf /var/lib/apt/lists/*
# Create docker group and add node user — entrypoint fixes GID at runtime
RUN groupadd -f docker && usermod -aG docker node
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
# Install Playwright Chromium to a shared path accessible by both root and node user
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx playwright install --with-deps chromium
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/worker/dist ./packages/worker/dist
COPY --from=builder /app/packages/worker/package.json ./packages/worker/
COPY --from=builder /app/packages/worker/review-app ./packages/worker/review-app
COPY --from=builder /app/package.json ./
# Entrypoint runs as root to fix docker socket GID, then drops to node user
COPY packages/worker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "packages/worker/dist/index.js"]
