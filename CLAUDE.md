# PreviewPR

PreviewPR backend — a GitHub App that auto-generates visual PR review guides. When a contributor opens a PR, PreviewPR screenshots each commit's visual changes, generates AI summaries, and presents a stepped review wizard for the project owner to approve or reject per commit.

## Stack

- Node.js 20, TypeScript
- BullMQ (job queue between API and Worker)
- better-sqlite3 (local persistence)
- Playwright (screenshots)
- Docker (container isolation for running user code)

## Architecture

Split into two processes:

- **API server** (`packages/api`) — Fastify. Receives GitHub webhooks, serves the review UI API, enqueues jobs.
- **Worker** (`packages/worker`) — BullMQ consumer. Runs the screenshot pipeline: clone repo, checkout commit, build, screenshot, AI summary.
- **Shared** (`packages/shared`) — Types, DB schema, constants shared between API and Worker.

## Deployment

Hetzner VPS (135.181.25.143) via Coolify. Monorepo with `packages/shared`, `packages/api`, `packages/worker`.

## Dev Commands

- `npm run dev:api` — start API server in dev mode
- `npm run dev:worker` — start worker in dev mode
- `npm run build` — build all packages (shared first, then api + worker)
- `npm run test` — run all tests
