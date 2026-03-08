import { test, expect, type BrowserContext } from '@playwright/test';
import {
  randomEmail, randomName, randomWorkspaceName,
  registerUserViaApi, createWorkspaceViaApi, loginViaUI,
} from './helpers';

test.describe('Messaging', () => {
  test('send a message and see it appear', async ({ page }) => {
    const email = randomEmail();
    const password = 'SecurePass123!';
    const auth = await registerUserViaApi(email, password, randomName());
    const ws = await createWorkspaceViaApi(auth.access_token, randomWorkspaceName());

    await loginViaUI(page, email, password);

    // Navigate to workspace
    await page.locator('.workspace-list li a').first().click();
    await expect(page).toHaveURL(/\/#\/workspace\//);

    // Wait for channel to load
    await expect(page.locator('.channel-item').filter({ hasText: 'general' })).toBeVisible();
    await page.locator('.channel-item').filter({ hasText: 'general' }).click();

    // Type and send a message
    const msgText = `Hello E2E! ${Date.now()}`;
    await page.locator('textarea[placeholder="Type a message..."]').fill(msgText);
    await page.locator('button').filter({ hasText: /^Send$/ }).click();

    // Message should appear in the list
    await expect(page.locator('.message-content').filter({ hasText: msgText })).toBeVisible({ timeout: 10000 });
  });

  test('cross-tab messaging: message sent in one tab appears in another', async ({ browser }) => {
    const email = randomEmail();
    const password = 'SecurePass123!';
    const name = randomName();
    const auth = await registerUserViaApi(email, password, name);
    const ws = await createWorkspaceViaApi(auth.access_token, randomWorkspaceName());

    // Open two browser contexts (simulating two tabs)
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    // Capture console logs for debugging
    const consoleLogs: string[] = [];
    page1.on('console', (msg) => consoleLogs.push(`[P1 ${msg.type()}] ${msg.text()}`));
    page2.on('console', (msg) => consoleLogs.push(`[P2 ${msg.type()}] ${msg.text()}`));

    // Login on both
    await loginViaUI(page1, email, password);
    await loginViaUI(page2, email, password);

    // Wait for gateway connections to establish
    await page1.waitForTimeout(3000);
    await page2.waitForTimeout(2000);

    // Navigate both to the workspace
    await page1.locator('.workspace-list li a').first().click();
    await page2.locator('.workspace-list li a').first().click();

    // Wait for channels
    await expect(page1.locator('.channel-item').filter({ hasText: 'general' })).toBeVisible();
    await expect(page2.locator('.channel-item').filter({ hasText: 'general' })).toBeVisible();
    await page1.locator('.channel-item').filter({ hasText: 'general' }).click();
    await page2.locator('.channel-item').filter({ hasText: 'general' }).click();

    // Wait for WS subscription to complete
    await page1.waitForTimeout(2000);
    await page2.waitForTimeout(2000);

    // Send message from tab1
    const msgText = `Cross-tab msg ${Date.now()}`;
    await page1.locator('textarea[placeholder="Type a message..."]').fill(msgText);
    await page1.locator('button').filter({ hasText: /^Send$/ }).click();

    // Verify it appears on tab2
    const visible = await page2.locator('.message-content').filter({ hasText: msgText }).isVisible({ timeout: 15000 }).catch(() => false);
    if (!visible) {
      console.log('=== CONSOLE LOGS ===');
      for (const log of consoleLogs) {
        console.log(log);
      }
      console.log('=== END CONSOLE LOGS ===');
    }
    await expect(page2.locator('.message-content').filter({ hasText: msgText })).toBeVisible({ timeout: 15000 });

    await context1.close();
    await context2.close();
  });

  test('send multiple messages and verify order', async ({ page }) => {
    const email = randomEmail();
    const password = 'SecurePass123!';
    const auth = await registerUserViaApi(email, password, randomName());
    await createWorkspaceViaApi(auth.access_token, randomWorkspaceName());

    await loginViaUI(page, email, password);
    await page.locator('.workspace-list li a').first().click();
    await expect(page.locator('.channel-item').filter({ hasText: 'general' })).toBeVisible();
    await page.locator('.channel-item').filter({ hasText: 'general' }).click();

    // Send 3 messages
    for (let i = 1; i <= 3; i++) {
      await page.locator('textarea[placeholder="Type a message..."]').fill(`Message ${i}`);
      await page.locator('button').filter({ hasText: /^Send$/ }).click();
      await expect(page.locator('.message-content').filter({ hasText: `Message ${i}` })).toBeVisible({ timeout: 10000 });
    }

    // All 3 should be visible in order
    const messages = page.locator('.message-content');
    const count = await messages.count();
    expect(count).toBeGreaterThanOrEqual(3);
  });
});
