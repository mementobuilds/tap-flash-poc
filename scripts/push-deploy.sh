#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

BRANCH="${1:-main}"
LIVE_URL="${LIVE_URL:-https://tap-flash-web-production.up.railway.app}"

LIVE_URL="$LIVE_URL" BRANCH="$BRANCH" node scripts/deploy-and-verify.js
