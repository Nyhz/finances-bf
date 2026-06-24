#!/bin/bash
# Invoked by launchd every 15 min. Hits the intraday watchlist-sync route.
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

# A batched refresh is quick; keep a tight ceiling so a hung provider can't pin
# the run until the next 15-min tick.
curl -fsS --max-time 120 \
  -X POST \
  -H "x-cron-secret: ${CRON_SECRET}" \
  http://localhost:3200/api/cron/sync-watchlist
