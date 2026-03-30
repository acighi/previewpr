#!/bin/sh
# Fix Docker socket permissions at runtime.
# The host's docker.sock GID may differ from the container's docker group GID.
# Detect and adjust so the 'node' user can communicate with Docker.
if [ -S /var/run/docker.sock ]; then
  SOCK_GID=$(stat -c '%g' /var/run/docker.sock 2>/dev/null || stat -f '%g' /var/run/docker.sock 2>/dev/null)
  if [ -n "$SOCK_GID" ] && [ "$SOCK_GID" != "0" ]; then
    # Update docker group to match socket GID
    groupmod -g "$SOCK_GID" docker 2>/dev/null || true
  fi
fi

# Ensure jobs directory is writable
mkdir -p /tmp/previewpr-jobs
chown node:node /tmp/previewpr-jobs

# Drop to node user
exec gosu node "$@"
