# integration-tests

E2E, contract, and protocol tests for all nfgmess services.

## Structure

- `tests/rust/` — Rust contract & protocol tests (HTTP + WebSocket binary protocol)
- `tests/e2e/` — Playwright browser E2E tests (real browser automation)
- `scripts/` — Test runner scripts
- `docker-compose.test.yml` — Service orchestration for CI

## Test Suites

### Rust Contract Tests (`tests/rust/tests/`)

API-level contract verification using direct HTTP and WebSocket connections:

- **auth_contract** — register, login, refresh, duplicate email, wrong password, unauthenticated access
- **workspace_contract** — CRUD, default channel creation
- **channel_contract** — public/private channels, join/leave, DM creation
- **gateway_protocol** — AUTH/SUBSCRIBE frame handshake, error on unauthenticated
- **message_flow** — cross-client message delivery via EVENT_BATCH
- **reactions** — reaction add/remove via wire protocol
- **threads** — thread reply delivery via wire protocol

### Playwright Browser Tests (`tests/e2e/tests/`)

Full browser automation testing the web-client UI:

- **auth** — register, login, logout, wrong password error, mismatched passwords
- **workspace-channels** — create workspace, default #general, create/browse/switch channels
- **messaging** — send message, cross-tab delivery, message ordering
- **multi-user** — invite flow, real-time Alice-to-Bob messaging, DM creation
- **threads-reactions** — add reactions, open thread panel, reply in thread

## Running

### All tests
```bash
./scripts/run-all.sh
```

### Rust only
```bash
cargo test -- --test-threads=1
```

### Playwright only
```bash
cd tests/e2e && pnpm test
```

### Playwright with browser visible
```bash
cd tests/e2e && pnpm test:headed
```

## Prerequisites

Services must be running:
- identity-service on :8081
- gateway on :8080/:8443
- web-client on :3000
- Infrastructure (postgres, nats, scylladb, etc.)
