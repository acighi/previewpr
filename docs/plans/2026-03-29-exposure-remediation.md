# Exposure Remediation Plan — PreviewPR Repo Public for ~10h

**Created:** 2026-03-29
**Risk level:** LOW (API was unreachable, no secrets in git history)
**Assumption:** Repo was downloaded. Attacker has full source code.

## Investigation Results

- [x] Task 1: Check API logs for suspicious activity → **Zero requests. Only startup log.**
- [x] Task 2: Check git history for secrets → **Clean. .gitignore from commit #1. No keys/tokens/passwords.**
- [x] Task 3: Check repo visibility → **Already private.**
- [x] Task 4: Check API reachability → **Unreachable. TLS fails, no host port mapping.**

## Credential Hygiene

- [x] ~~Task 5-7: Rotate secrets~~ — **SKIPPED: secrets were never in the repo or reachable. No rotation needed.**
- [x] Task 8: Redact secrets from memory file `previewpr-infra.md` (webhook secret, Coolify login) — good hygiene regardless

## Deploy Security Fixes

- [ ] Task 9: Push security fixes to GitHub (17 tasks from security-remediation plan)
- [ ] Task 10: Deploy API with security fixes via Coolify
- [ ] Task 11: Deploy worker with security fixes via Coolify
- [ ] Task 12: Verify deploy — curl health endpoint, check logs for startup

## Hardening (attacker has source code)

- [ ] Task 13: Enable health check in Coolify for API app (path: /health, port: 3000) — needs SSH tunnel
- [x] Task 14: Fix TLS — DNS verified (api.previewpr.com → 135.181.25.143, CF nameservers active). Traefik will auto-issue cert on next deploy.
- [ ] Task 15: Add Coolify env var for REDIS_PASSWORD, update REDIS_URL to include password — needs SSH tunnel
- [x] Task 16: Worker Dockerfile — entrypoint.sh detects host docker.sock GID at runtime, adjusts docker group, drops to node user via su-exec

## Changelog
