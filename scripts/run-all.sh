#!/usr/bin/env bash
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
AUTH_COOLDOWN_SECS="${AUTH_COOLDOWN_SECS:-6}"

echo "=== nfgmess Integration Tests ==="
echo ""

# Wait for services
"$SCRIPT_DIR/wait-for-services.sh"

echo ""
echo "--- Rust Contract & Protocol Tests ---"
cd "$ROOT_DIR"
if cargo test -- --test-threads=1 2>&1; then
  RUST_EXIT=0
else
  RUST_EXIT=$?
fi

echo ""
echo "--- Playwright Browser E2E Tests ---"
echo "Cooling down auth rate limiter for ${AUTH_COOLDOWN_SECS}s..."
sleep "$AUTH_COOLDOWN_SECS"
cd "$ROOT_DIR/tests/e2e"
if pnpm test 2>&1; then
  PW_EXIT=0
else
  PW_EXIT=$?
fi

echo ""
echo "=== Results ==="
[ $RUST_EXIT -eq 0 ] && echo "  Rust:       PASS" || echo "  Rust:       FAIL"
[ $PW_EXIT -eq 0 ]   && echo "  Playwright: PASS" || echo "  Playwright: FAIL"

if [ $RUST_EXIT -eq 0 ] && [ $PW_EXIT -eq 0 ]; then
  exit 0
fi

exit 1
