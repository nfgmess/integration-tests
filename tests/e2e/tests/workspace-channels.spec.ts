import { test, expect } from '@playwright/test';
import {
  randomEmail, randomName, randomWorkspaceName, randomChannelName,
  loginViaUI, registerUserViaApi,
} from './helpers';

test.describe('Workspaces and Channels', () => {
  let email: string;
  let password: string;

  test.beforeEach(async ({ page }) => {
    email = randomEmail();
    password = 'SecurePass123!';
    await registerUserViaApi(email, password, randomName());
    await loginViaUI(page, email, password);
  });

  test('create a workspace', async ({ page }) => {
    const wsName = randomWorkspaceName();
    await page.locator('a').filter({ hasText: 'Create Workspace' }).click();
    await expect(page).toHaveURL(/\/#\/create-workspace/);

    await page.locator('input[placeholder="Workspace name"]').fill(wsName);
    await page.locator('button[type="submit"]').click();

    // Should redirect to workspace view
    await expect(page).toHaveURL(/\/#\/workspace\//);
  });

  test('new workspace has default general channel', async ({ page }) => {
    await page.locator('a').filter({ hasText: 'Create Workspace' }).click();
    await page.locator('input[placeholder="Workspace name"]').fill(randomWorkspaceName());
    await page.locator('button[type="submit"]').click();

    await expect(page).toHaveURL(/\/#\/workspace\//);

    // Sidebar should show #general
    await expect(page.locator('.channel-item').filter({ hasText: 'general' })).toBeVisible();
  });

  test('create a new public channel via browser modal', async ({ page }) => {
    // Create workspace first
    await page.locator('a').filter({ hasText: 'Create Workspace' }).click();
    await page.locator('input[placeholder="Workspace name"]').fill(randomWorkspaceName());
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/#\/workspace\//);

    // Open channel browser
    await page.locator('button[title="Create channel"]').click();

    // Click "Create a new channel"
    await page.locator('button').filter({ hasText: 'Create a new channel' }).click();

    const chName = randomChannelName();
    await page.locator('#channel-name').fill(chName);
    // Type is public by default
    await page.locator('button').filter({ hasText: /Create Channel/ }).click();

    // Channel should appear in sidebar
    await expect(page.locator('.channel-item').filter({ hasText: chName })).toBeVisible({ timeout: 10000 });
  });

  test('create a private channel', async ({ page }) => {
    await page.locator('a').filter({ hasText: 'Create Workspace' }).click();
    await page.locator('input[placeholder="Workspace name"]').fill(randomWorkspaceName());
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/#\/workspace\//);

    await page.locator('button[title="Create channel"]').click();
    await page.locator('button').filter({ hasText: 'Create a new channel' }).click();

    const chName = randomChannelName();
    await page.locator('#channel-name').fill(chName);
    await page.locator('#channel-type').selectOption('private');
    await page.locator('button').filter({ hasText: /Create Channel/ }).click();

    await expect(page.locator('.channel-item').filter({ hasText: chName })).toBeVisible({ timeout: 10000 });
  });

  test('switch between channels', async ({ page }) => {
    await page.locator('a').filter({ hasText: 'Create Workspace' }).click();
    await page.locator('input[placeholder="Workspace name"]').fill(randomWorkspaceName());
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/#\/workspace\//);

    // Create a second channel
    await page.locator('button[title="Create channel"]').click();
    await page.locator('button').filter({ hasText: 'Create a new channel' }).click();
    const chName = randomChannelName();
    await page.locator('#channel-name').fill(chName);
    await page.locator('button').filter({ hasText: /Create Channel/ }).click();
    await expect(page.locator('.channel-item').filter({ hasText: chName })).toBeVisible({ timeout: 10000 });

    // Click general channel
    await page.locator('.channel-item').filter({ hasText: 'general' }).click();
    await expect(page.locator('.header-name')).toContainText('general');

    // Click custom channel
    await page.locator('.channel-item').filter({ hasText: chName }).click();
    await expect(page.locator('.header-name')).toContainText(chName);
  });
});
