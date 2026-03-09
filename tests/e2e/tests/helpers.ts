import { type Page, expect } from '@playwright/test';

const API_BASE = process.env.API_BASE || 'http://localhost:8081/api/v1';
const AUTH_RETRY_ATTEMPTS = 10;
const AUTH_RETRY_DELAY_MS = 1100;
const AUTH_RETRY_BUFFER_MS = 1000;
const AUTH_RETRY_MAX_DELAY_MS = 95_000;
const UI_AUTH_COOLDOWN_MS = 1200;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterHeader(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const retryAt = Date.parse(value);
  if (Number.isNaN(retryAt)) {
    return null;
  }

  return Math.max(0, retryAt - Date.now());
}

function parseRetryAfterBody(body: string): number | null {
  const waitMatch = body.match(/wait for\s+(\d+)\s*(ms|milliseconds|s|sec|secs|seconds)?/i);
  if (!waitMatch) {
    return null;
  }

  const amount = Number(waitMatch[1]);
  if (!Number.isFinite(amount) || amount < 0) {
    return null;
  }

  const unit = waitMatch[2]?.toLowerCase();
  if (unit === 'ms' || unit === 'milliseconds') {
    return amount;
  }

  return amount * 1000;
}

function resolveRateLimitDelay(response: Response, body: string, attempt: number): number {
  const headerDelay = parseRetryAfterHeader(response.headers.get('retry-after'));
  const bodyDelay = parseRetryAfterBody(body);
  const fallbackDelay = AUTH_RETRY_DELAY_MS * (attempt + 1);

  return Math.min(
    AUTH_RETRY_MAX_DELAY_MS,
    Math.max(headerDelay ?? 0, bodyDelay ?? 0, fallbackDelay) + AUTH_RETRY_BUFFER_MS,
  );
}

async function fetchWithRateLimitRetry(url: string, init: RequestInit): Promise<Response> {
  for (let attempt = 0; attempt < AUTH_RETRY_ATTEMPTS; attempt++) {
    const response = await fetch(url, init);
    if (response.status !== 429) {
      return response;
    }

    if (attempt === AUTH_RETRY_ATTEMPTS - 1) {
      return response;
    }

    const body = await response.text().catch(() => '');
    await sleep(resolveRateLimitDelay(response, body, attempt));
  }

  throw new Error(`Exceeded auth retry budget for ${url}`);
}

export function randomEmail(): string {
  return `test_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`;
}

export function randomName(): string {
  return `TestUser_${Math.random().toString(36).slice(2)}`;
}

export function randomWorkspaceName(): string {
  return `Workspace ${Math.random().toString(36).slice(2, 8)}`;
}

export function randomChannelName(): string {
  return `channel-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Register a user and login via API (faster than going through UI for setup).
 * Register returns {user_id, email} (no token), so we login immediately after.
 */
export async function registerUserViaApi(email: string, password: string, displayName: string) {
  const regRes = await fetchWithRateLimitRetry(`${API_BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, display_name: displayName }),
  });
  if (!regRes.ok) throw new Error(`Register failed: ${regRes.status} ${await regRes.text()}`);

  const loginRes = await fetchWithRateLimitRetry(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!loginRes.ok) throw new Error(`Login failed: ${loginRes.status} ${await loginRes.text()}`);
  const data = await loginRes.json() as { token: string; refresh_token: string; user_id: string };
  return { access_token: data.token, refresh_token: data.refresh_token, user_id: data.user_id };
}

/**
 * Create workspace via API.
 */
export async function createWorkspaceViaApi(token: string, name: string) {
  const res = await fetch(`${API_BASE}/workspaces`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`Create workspace failed: ${res.status} ${await res.text()}`);
  const data = await res.json() as { id: string; name: string; slug: string };
  return { workspace_id: data.id, name: data.name, slug: data.slug };
}

/**
 * Create invite via API.
 * Actual endpoint: POST /workspaces/{workspace_id}/invite (singular)
 * Response: { id, code, workspace_id, max_uses, use_count, expires_at }
 */
export async function createInviteViaApi(token: string, workspaceId: string) {
  const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/invite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(`Create invite failed: ${res.status} ${await res.text()}`);
  const data = await res.json() as { id: string; code: string; workspace_id: string };
  return { invite_code: data.code, workspace_id: data.workspace_id };
}

/**
 * Join workspace via invite code (API).
 * Actual endpoint: POST /workspaces/{workspace_id}/join with body { code }
 */
export async function joinWorkspaceViaApi(token: string, workspaceId: string, inviteCode: string) {
  const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ code: inviteCode }),
  });
  if (!res.ok) throw new Error(`Join workspace failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<{ workspace_id: string; role: string }>;
}

export async function createDmViaApi(token: string, workspaceId: string, userIds: string[]) {
  const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/dm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ user_ids: userIds }),
  });
  if (!res.ok) throw new Error(`Create DM failed: ${res.status} ${await res.text()}`);
  const data = await res.json() as { channel_id?: string; id?: string; name: string; channel_type: string };
  return {
    channel_id: data.channel_id || data.id || '',
    name: data.name,
    channel_type: data.channel_type,
  };
}

/**
 * Login through the web UI.
 */
export async function loginViaUI(page: Page, email: string, password: string) {
  await page.goto('/#/login');
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.waitForTimeout(UI_AUTH_COOLDOWN_MS);
  await page.locator('button[type="submit"]').click();
  // Wait for redirect to home page (workspace list)
  await expect(page).toHaveURL(/\/#\/?$/);
  await page.waitForTimeout(UI_AUTH_COOLDOWN_MS);
}

/**
 * Register through the web UI.
 */
export async function registerViaUI(page: Page, displayName: string, email: string, password: string) {
  await page.goto('/#/register');
  await page.locator('input[type="text"]').fill(displayName);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  await page.locator('input[type="password"]').nth(1).fill(password);
  await page.waitForTimeout(UI_AUTH_COOLDOWN_MS);
  await page.locator('button[type="submit"]').click();
  // Wait for redirect to home
  await expect(page).toHaveURL(/\/#\/?$/);
  await page.waitForTimeout(UI_AUTH_COOLDOWN_MS);
}
