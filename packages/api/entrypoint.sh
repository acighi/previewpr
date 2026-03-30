#!/bin/sh
# Ensure data directory exists and is writable by the node user
mkdir -p /app/data
chown -R node:node /app/data
# Drop to non-root user for the actual process
exec su-exec node "$@"
