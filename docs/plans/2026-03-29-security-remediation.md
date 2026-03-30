# Security Remediation Plan — PreviewPR

**Created:** 2026-03-29
**Audit date:** 2026-03-29
**Findings:** 3 Critical, 5 High, 7 Medium

## Stage 1: Token & Data Leaks (CRITICAL)

- [x] Task 1: Replace token-in-URL with GIT_ASKPASS in `worker/src/pipeline.ts`
- [x] Task 2: Add `scrubSecrets()` utility in `shared/src/security.ts`
- [x] Task 3: Apply scrubSecrets to error messages in `worker/src/index.ts` before DB insert and PR comment

## Stage 2: SSRF & Sandbox Escape (CRITICAL)

- [x] Task 4: Validate `review-guide.config.json` routes in `worker/src/pipeline/analyze-diff.ts`
- [x] Task 5: Add `--ignore-scripts` + `--security-opt=no-new-privileges` to install container in `worker/src/docker.ts`

## Stage 3: Auth & Input Validation (HIGH)

- [x] Task 6: Add `validateBranchName()` in `shared/src/security.ts`, call from `pipeline.ts`
- [x] Task 7: Harden `/install/callback` with GitHub OAuth code exchange in `api/src/index.ts`
- [x] Task 8: Add HMAC-signed tokens to `/jobs/:jobId` endpoint, strip error_message from response

## Stage 4: Container Hardening (HIGH)

- [x] Task 9: Drop root privileges in API Dockerfile + entrypoint.sh (su-exec pattern)
- [x] Task 10: Add USER directive to worker Dockerfile (node user + docker group)

## Stage 5: Defense in Depth (MEDIUM)

- [x] Task 11: Change rate limiting to `global: true` with 100 req/min default
- [x] Task 12: Add structured error logging in Claude API catch blocks (auth/rate/network differentiation)
- [x] Task 13: Add prompt injection mitigation (XML delimiters + system instruction)
- [x] Task 14: Add Redis password to docker-compose + .env.example
- [x] Task 15: Replace console.log/error with createLogger() across all pipeline stages
- [x] Task 16: Sanitize screenshot filenames in deploy-review-app.ts (filter path traversal)
- [x] Task 17: Container names already use jobId prefix (verified unique), resource limits in buildInstallArgs/buildRunArgs

## Changelog
- 2026-03-29: All 17 tasks implemented. Task 5 changed approach: instead of `--network=none` (which breaks npm install), used `--ignore-scripts` to prevent malicious postinstall scripts + `--security-opt=no-new-privileges`. Task 17: verified container names already use `ppr-main-{jobId}` and `ppr-pr-{jobId}` pattern — no collision risk. Resource limits already in buildInstallArgs/buildRunArgs.
