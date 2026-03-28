#!/bin/sh
# Ensure data directory exists and is writable
mkdir -p /app/data
exec "$@"
