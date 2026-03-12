#!/usr/bin/env bash
# Release test: run the full generate pipeline once and show result URL.
# Run this on M1 after deploying a new release to validate end-to-end.
#
# Usage: bash scripts/release-test.sh

set -euo pipefail

BASE_DIR="/Users/nfainstein/content-engine"
LOG_DIR="$BASE_DIR/logs"
NODE="/Users/nfainstein/.nvm/versions/node/v22.18.0/bin/node"
export PATH="/Users/nfainstein/bin:/opt/homebrew/bin:$PATH"

echo "=== Content Engine Release Test ==="
echo "$(date)"
echo ""

cd "$BASE_DIR"

# 1. Build first
echo "[1/3] Building..."
pnpm build 2>&1 | tail -5
echo "Build OK"
echo ""

# 2. Run generate job once
echo "[2/3] Running generate job..."
"$NODE" dist/jobs/generate.js 2>&1 | tail -30
echo ""

# 3. Run post job once
echo "[3/3] Running post job..."
"$NODE" dist/jobs/post.js 2>&1 | tail -30
echo ""

# 4. Show latest YouTube URL from logs
echo "=== Latest YouTube URL ==="
grep -oE 'https://youtube.com/shorts/[a-zA-Z0-9_-]+' "$LOG_DIR/post.log" 2>/dev/null | tail -3 || echo "(no URL found in logs yet)"

echo ""
echo "=== Done ==="
echo "Check the YouTube URL above to evaluate the video."
