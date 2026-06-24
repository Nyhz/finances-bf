#!/bin/bash
# Invoked by launchd weekly (Monday 15:30 Madrid). Hits the discover-scan route.
set -eu

FINANCES_DIR="/Users/nyhzdev/devroom/battlefields/finances"
LOG_DIR="$HOME/.finances/logs"
mkdir -p "$LOG_DIR"

cd "$FINANCES_DIR"

# Load CRON_SECRET from .env.local.
set -a
# shellcheck disable=SC1091
source .env.local
set +a

# Agent + per-candidate verification can take minutes — generous ceiling.
curl -fsS --max-time 900 \
  -X POST \
  -H "x-cron-secret: ${CRON_SECRET}" \
  http://localhost:3200/api/cron/discover-scan
