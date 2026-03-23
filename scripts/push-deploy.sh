#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

BRANCH="${1:-main}"
LIVE_URL="https://tap-flash-web-production.up.railway.app"

echo "Pushing ${BRANCH} to origin..."
git push origin "$BRANCH"

echo
echo "Railway autodeploy should now build from GitHub."
echo "Stable URL: ${LIVE_URL}"
