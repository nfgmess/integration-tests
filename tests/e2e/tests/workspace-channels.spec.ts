import { test, expect } from '@playwright/test';
import {
  randomEmail, randomName, randomWorkspaceName, randomChannelName,
  loginViaUI, registerUserViaApi,
} from './helpers';
const { measureE2E } = require('./perf.cjs');

test.describe('Workspaces and Channels', () => {
  let email: string;
  let password: string;

  test.beforeEach(async ({ page }, testInfo) => {
    email = randomEmail();
    password = 'SecurePass123!';
    await registerUserViaApi(email, password, randomName(), testInfo);
    await loginViaUI(page, email, password, testInfo);
  });

  test('create a workspace', async ({ page }) => {
    const wsName = randomWorkspaceName();
    const perf = test.info();
    await measureE2E(perf, 'workspace.create_ui', { phase: 'ui' }, async () => {
      await page.locator('a').filter({ hasText: 'Create Workspace' }).click();
      await expect(page).toHaveURL(/\/#\/create-workspace/);
      await page.locator('input[placeholder="Workspace name"]').fill(wsName);
      await page.locator('button[type="submit"]').click();
      await expect(page).toHaveURL(/\/#\/workspace\//);
    });
  });

  test('new workspace has default general channel', async ({ page }) => {
    const perf = test.info();
    await measureE2E(perf, 'workspace.general_channel_visible_ui', { phase: 'ui' }, async () => {
      await page.locator('a').filter({ hasText: 'Create Workspace' }).click();
      await page.locator('input[placeholder="Workspace name"]').fill(randomWorkspaceName());
      await page.locator('button[type="submit"]').click();
      await expect(page).toHaveURL(/\/#\/workspace\//);
      await expect(page.locator('.channel-item').filter({ hasText: 'general' })).toBeVisible();
    });
  });

  test('workspace owner can generate an invite link from the workspace view', async ({ page }) => {
    const perf = test.info();
    await page.locator('a').filter({ hasText: 'Create Workspace' }).click();
    await page.locator('input[placeholder="Workspace name"]').fill(randomWorkspaceName());
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/#\/workspace\//);
    await measureE2E(perf, 'workspace.invite_modal_ui', { phase: 'ui' }, async () => {
      await page.locator('button[title="Invite members and manage workspace"]').click();
      const inviteLinkInput = page.locator('input[readonly]').filter({ hasValue: /#\/invite\// });
      await expect(inviteLinkInput).toBeVisible({ timeout: 10000 });
    });
  });

  test('default general channel cannot be left, but regular channels can', async ({ page }) => {
    await page.locator('a').filter({ hasText: 'Create Workspace' }).click();
    await page.locator('input[placeholder="Workspace name"]').fill(randomWorkspaceName());
    await page.locator('button[type="submit"]').click();

    await expect(page).toHaveURL(/\/#\/workspace\//);
    await expect(page.locator('.header-name')).toContainText('general');
    await expect(page.locator('button[title="Leave channel"]')).toHaveCount(0);

    await page.locator('button[title="Create channel"]').click();
    await page.locator('button').filter({ hasText: 'Create a new channel' }).click();

    const chName = randomChannelName();
    await page.locator('#channel-name').fill(chName);
    await page.locator('button').filter({ hasText: /Create Channel/ }).click();

    const customChannel = page.locator('.channel-item').filter({ hasText: chName });
    await expect(customChannel).toBeVisible({ timeout: 10000 });
    await customChannel.click();

    await expect(page.locator('.header-name')).toContainText(chName);
    await expect(page.locator('button[title="Leave channel"]')).toBeVisible();
  });

  test('create a new public channel via browser modal', async ({ page }) => {
    const perf = test.info();
    // Create workspace first
    await page.locator('a').filter({ hasText: 'Create Workspace' }).click();
    await page.locator('input[placeholder="Workspace name"]').fill(randomWorkspaceName());
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/#\/workspace\//);

    const chName = randomChannelName();
    await measureE2E(perf, 'channel.create_public_ui', { phase: 'ui' }, async () => {
      await page.locator('button[title="Create channel"]').click();
      await page.locator('button').filter({ hasText: 'Create a new channel' }).click();
      await page.locator('#channel-name').fill(chName);
      await page.locator('button').filter({ hasText: /Create Channel/ }).click();
      await expect(page.locator('.channel-item').filter({ hasText: chName })).toBeVisible({ timeout: 10000 });
    });
  });

  test('create a private channel', async ({ page }) => {
    const perf = test.info();
    await page.locator('a').filter({ hasText: 'Create Workspace' }).click();
    await page.locator('input[placeholder="Workspace name"]').fill(randomWorkspaceName());
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/#\/workspace\//);

    const chName = randomChannelName();
    await measureE2E(perf, 'channel.create_private_ui', { phase: 'ui' }, async () => {
      await page.locator('button[title="Create channel"]').click();
      await page.locator('button').filter({ hasText: 'Create a new channel' }).click();
      await page.locator('#channel-name').fill(chName);
      await page.locator('#channel-type').selectOption('private');
      await page.locator('button').filter({ hasText: /Create Channel/ }).click();
      await expect(page.locator('.channel-item').filter({ hasText: chName })).toBeVisible({ timeout: 10000 });
    });
  });

  test('switch between channels', async ({ page }) => {
    const perf = test.info();
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

    await measureE2E(perf, 'channel.switch_ui', { phase: 'ui' }, async () => {
      await page.locator('.channel-item').filter({ hasText: 'general' }).click();
      await expect(page.locator('.header-name')).toContainText('general');
      await page.locator('.channel-item').filter({ hasText: chName }).click();
      await expect(page.locator('.header-name')).toContainText(chName);
    });
  });
});
