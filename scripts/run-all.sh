#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=== nfgmess Integration Tests ==="
echo ""

# Wait for services
"$SCRIPT_DIR/wait-for-services.sh"

echo ""
echo "--- Rust Contract & Protocol Tests ---"
cd "$ROOT_DIR"
cargo test -- --test-threads=1 2>&1
RUST_EXIT=$?

echo ""
echo "--- Playwright Browser E2E Tests ---"
cd "$ROOT_DIR/tests/e2e"
pnpm test 2>&1
PW_EXIT=$?

echo ""
echo "=== Results ==="
[ $RUST_EXIT -eq 0 ] && echo "  Rust:       PASS" || echo "  Rust:       FAIL"
[ $PW_EXIT -eq 0 ]   && echo "  Playwright: PASS" || echo "  Playwright: FAIL"

exit $((RUST_EXIT + PW_EXIT))
