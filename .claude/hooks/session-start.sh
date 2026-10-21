#!/bin/bash
# Readies a Claude Code cloud session: packages installed, the app built, and the browser
# tests pointed at the preinstalled Chromium. Does nothing on the owner's own machine.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# Install only when node_modules is missing or older than the lockfile. npm ci (not install), so
# a different npm version in the sandbox never rewrites package-lock.json.
if [ ! -f node_modules/.package-lock.json ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  npm ci --no-audit --no-fund --loglevel=error
fi

# The API and browser suites run against the existing build.
npx next build > /dev/null

if [ -n "${CLAUDE_ENV_FILE:-}" ] && [ -x /opt/pw-browsers/chromium ]; then
  echo 'export E2E_EXECUTABLE=/opt/pw-browsers/chromium' >> "$CLAUDE_ENV_FILE"
fi
