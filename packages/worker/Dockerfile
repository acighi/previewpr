FROM node:20-bookworm AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/worker/package.json packages/worker/
RUN npm ci --workspace=packages/shared --workspace=packages/worker
COPY packages/shared/ packages/shared/
COPY packages/worker/ packages/worker/
RUN npm run build -w packages/shared && npm run build -w packages/worker

FROM node:20-bookworm-slim
# Install Playwright + Chromium dependencies
RUN npx playwright install --with-deps chromium
# Install Docker CLI (for spawning sandbox containers)
RUN apt-get update && apt-get install -y docker.io && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/worker/dist ./packages/worker/dist
COPY --from=builder /app/packages/worker/package.json ./packages/worker/
COPY --from=builder /app/packages/worker/review-app ./packages/worker/review-app
COPY --from=builder /app/package.json ./
CMD ["node", "packages/worker/dist/index.js"]
