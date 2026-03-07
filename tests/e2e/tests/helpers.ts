import { type Page, expect } from '@playwright/test';

const API_BASE = process.env.API_BASE || 'http://localhost:8081/api/v1';

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
 * Register a user via API (faster than going through UI for setup).
 */
export async function registerUserViaApi(email: string, password: string, displayName: string) {
  const res = await fetch(`${API_BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, display_name: displayName }),
  });
  if (!res.ok) throw new Error(`Register failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<{ access_token: string; refresh_token: string; user_id: string }>;
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
  if (!res.ok) throw new Error(`Create workspace failed: ${res.status}`);
  return res.json() as Promise<{ workspace_id: string; name: string; slug: string }>;
}

/**
 * Create invite via API.
 */
export async function createInviteViaApi(token: string, workspaceId: string) {
  const res = await fetch(`${API_BASE}/workspaces/${workspaceId}/invites`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Create invite failed: ${res.status}`);
  return res.json() as Promise<{ invite_code: string }>;
}

/**
 * Login through the web UI.
 */
export async function loginViaUI(page: Page, email: string, password: string) {
  await page.goto('/#/login');
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  // Wait for redirect to home page (workspace list)
  await expect(page).toHaveURL(/\/#\/?$/);
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
  await page.locator('button[type="submit"]').click();
  // Wait for redirect to home
  await expect(page).toHaveURL(/\/#\/?$/);
}
