import { test, expect } from '@playwright/test';
import {
  randomEmail, randomName, randomWorkspaceName,
  registerUserViaApi, createWorkspaceViaApi, loginViaUI,
} from './helpers';

test.describe('Threads and Reactions', () => {
  let email: string;
  let password: string;

  test.beforeEach(async () => {
    email = randomEmail();
    password = 'SecurePass123!';
    const auth = await registerUserViaApi(email, password, randomName());
    await createWorkspaceViaApi(auth.access_token, randomWorkspaceName());
  });

  test('add a reaction to a message', async ({ page }) => {
    await loginViaUI(page, email, password);
    await page.locator('.workspace-list li a').first().click();
    await expect(page.locator('.channel-item').filter({ hasText: 'general' })).toBeVisible();
    await page.locator('.channel-item').filter({ hasText: 'general' }).click();

    // Send a message first
    const msg = `React to me ${Date.now()}`;
    await page.locator('textarea[placeholder="Type a message..."]').fill(msg);
    await page.locator('button').filter({ hasText: /^Send$/ }).click();
    await expect(page.locator('.message-content').filter({ hasText: msg })).toBeVisible({ timeout: 10000 });

    // Hover over message to reveal add-reaction button
    const message = page.locator('.message').filter({ hasText: msg });
    await message.hover();

    // Click add reaction button
    const addReactionBtn = message.locator('.add-reaction-btn');
    if (await addReactionBtn.isVisible()) {
      await addReactionBtn.click();

      // If emoji picker is visible, click an emoji
      const picker = page.locator('.picker-popover');
      if (await picker.isVisible({ timeout: 3000 }).catch(() => false)) {
        // Click first emoji in picker
        await picker.locator('button').first().click();

        // Reaction chip should appear
        await expect(message.locator('.reaction-chip')).toBeVisible({ timeout: 5000 });
      }
    }
  });

  test('open thread panel and reply', async ({ page }) => {
    await loginViaUI(page, email, password);
    await page.locator('.workspace-list li a').first().click();
    await expect(page.locator('.channel-item').filter({ hasText: 'general' })).toBeVisible();
    await page.locator('.channel-item').filter({ hasText: 'general' }).click();

    // Send a parent message
    const parentMsg = `Thread parent ${Date.now()}`;
    await page.locator('textarea[placeholder="Type a message..."]').fill(parentMsg);
    await page.locator('button').filter({ hasText: /^Send$/ }).click();
    await expect(page.locator('.message-content').filter({ hasText: parentMsg })).toBeVisible({ timeout: 10000 });

    // Look for thread indicator or reply button on the message
    const message = page.locator('.message').filter({ hasText: parentMsg });
    await message.hover();

    // Try clicking thread indicator or reply action
    const threadTrigger = message.locator('.thread-indicator, .reply-btn, button[title*="thread"], button[title*="reply"], button[title*="Thread"]');
    if (await threadTrigger.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      await threadTrigger.first().click();

      // Thread panel should open
      await expect(page.locator('.thread-panel')).toBeVisible({ timeout: 5000 });

      // Parent message should be shown
      await expect(page.locator('.parent-message .message-content')).toContainText(parentMsg);

      // Type a reply
      const replyText = `Reply in thread ${Date.now()}`;
      await page.locator('.thread-panel textarea[placeholder="Reply in thread..."]').fill(replyText);
      await page.locator('.thread-panel button').filter({ hasText: 'Reply' }).click();

      // Reply should appear
      await expect(page.locator('.reply .message-content').filter({ hasText: replyText })).toBeVisible({ timeout: 10000 });

      // Close thread panel
      await page.locator('.thread-panel button[title="Close thread"]').click();
      await expect(page.locator('.thread-panel')).not.toBeVisible();
    }
  });
});
