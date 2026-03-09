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
    await expect(addReactionBtn).toBeVisible({ timeout: 5000 });
    await addReactionBtn.click();

    const picker = page.locator('.picker-popover');
    await expect(picker).toBeVisible({ timeout: 5000 });
    await picker.locator('.emoji-grid .emoji-btn').first().click();

    // Reaction chip should appear
    await expect(message.locator('.reaction-chip')).toBeVisible({ timeout: 5000 });
  });

  test('reaction survives page reload', async ({ page }) => {
    await loginViaUI(page, email, password);
    await page.locator('.workspace-list li a').first().click();
    await expect(page.locator('.channel-item').filter({ hasText: 'general' })).toBeVisible();
    await page.locator('.channel-item').filter({ hasText: 'general' }).click();

    const msg = `Reaction persists ${Date.now()}`;
    await page.locator('textarea[placeholder="Type a message..."]').fill(msg);
    await page.locator('button').filter({ hasText: /^Send$/ }).click();

    const message = page.locator('.message').filter({ hasText: msg }).last();
    await expect(message.locator('.message-content').filter({ hasText: msg })).toBeVisible({ timeout: 10000 });
    await message.hover();

    const addReactionBtn = message.locator('.add-reaction-btn');
    await expect(addReactionBtn).toBeVisible({ timeout: 5000 });
    await addReactionBtn.click();

    const picker = page.locator('.picker-popover');
    await expect(picker).toBeVisible({ timeout: 5000 });
    await picker.locator('.emoji-grid .emoji-btn').first().click();

    const reactionChip = message.locator('.reaction-chip');
    await expect(reactionChip).toBeVisible({ timeout: 5000 });
    const reactionEmoji = await reactionChip.locator('.reaction-emoji').textContent();

    await page.reload();
    await expect(page).toHaveURL(/\/#\/workspace\//);
    await expect(page.locator('.channel-item').filter({ hasText: 'general' })).toBeVisible({ timeout: 10000 });
    await page.locator('.channel-item').filter({ hasText: 'general' }).click();

    const reloadedMessage = page.locator('.message').filter({ hasText: msg }).last();
    await expect(reloadedMessage.locator('.message-content').filter({ hasText: msg })).toBeVisible({ timeout: 15000 });
    await expect(reloadedMessage.locator('.reaction-chip')).toBeVisible({ timeout: 15000 });
    await expect(reloadedMessage.locator('.reaction-emoji')).toHaveText(reactionEmoji ?? '', { timeout: 15000 });
  });

  test('reaction appears in another tab and survives reload there', async ({ browser }) => {
    const context = await browser.newContext();
    const page1 = await context.newPage();
    const page2 = await context.newPage();

    await loginViaUI(page1, email, password);
    await loginViaUI(page2, email, password);

    await page1.locator('.workspace-list li a').first().click();
    await page2.locator('.workspace-list li a').first().click();
    await expect(page1.locator('.channel-item').filter({ hasText: 'general' })).toBeVisible();
    await expect(page2.locator('.channel-item').filter({ hasText: 'general' })).toBeVisible();
    await page1.locator('.channel-item').filter({ hasText: 'general' }).click();
    await page2.locator('.channel-item').filter({ hasText: 'general' }).click();

    const msg = `Cross-tab reaction ${Date.now()}`;
    await page1.locator('textarea[placeholder="Type a message..."]').fill(msg);
    await page1.locator('button').filter({ hasText: /^Send$/ }).click();

    const page1Message = page1.locator('.message').filter({ hasText: msg }).last();
    const page2Message = page2.locator('.message').filter({ hasText: msg }).last();
    await expect(page1Message.locator('.message-content').filter({ hasText: msg })).toBeVisible({ timeout: 10000 });
    await expect(page2Message.locator('.message-content').filter({ hasText: msg })).toBeVisible({ timeout: 15000 });

    await page1Message.hover();
    const addReactionBtn = page1Message.locator('.add-reaction-btn');
    await expect(addReactionBtn).toBeVisible({ timeout: 5000 });
    await addReactionBtn.click();

    const picker = page1.locator('.picker-popover');
    await expect(picker).toBeVisible({ timeout: 5000 });
    await picker.locator('.emoji-grid .emoji-btn').first().click();

    const reactionChip = page1Message.locator('.reaction-chip');
    await expect(reactionChip).toBeVisible({ timeout: 5000 });
    const reactionEmoji = await reactionChip.locator('.reaction-emoji').textContent();

    await expect(page2Message.locator('.reaction-chip')).toBeVisible({ timeout: 15000 });
    await expect(page2Message.locator('.reaction-emoji')).toHaveText(reactionEmoji ?? '', { timeout: 15000 });

    await page2.reload();
    await expect(page2).toHaveURL(/\/#\/workspace\//);
    await expect(page2.locator('.channel-item').filter({ hasText: 'general' })).toBeVisible({ timeout: 10000 });
    await page2.locator('.channel-item').filter({ hasText: 'general' }).click();

    const reloadedPage2Message = page2.locator('.message').filter({ hasText: msg }).last();
    await expect(reloadedPage2Message.locator('.message-content').filter({ hasText: msg })).toBeVisible({ timeout: 15000 });
    await expect(reloadedPage2Message.locator('.reaction-chip')).toBeVisible({ timeout: 15000 });
    await expect(reloadedPage2Message.locator('.reaction-emoji')).toHaveText(reactionEmoji ?? '', { timeout: 15000 });

    await context.close();
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
    await expect(threadTrigger.first()).toBeVisible({ timeout: 5000 });
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
  });

  test('thread reply survives page reload', async ({ page }) => {
    await loginViaUI(page, email, password);
    await page.locator('.workspace-list li a').first().click();
    await expect(page.locator('.channel-item').filter({ hasText: 'general' })).toBeVisible();
    await page.locator('.channel-item').filter({ hasText: 'general' }).click();

    const parentMsg = `Thread parent persists ${Date.now()}`;
    await page.locator('textarea[placeholder="Type a message..."]').fill(parentMsg);
    await page.locator('button').filter({ hasText: /^Send$/ }).click();

    const parentMessage = page.locator('.message').filter({ hasText: parentMsg }).last();
    await expect(parentMessage.locator('.message-content').filter({ hasText: parentMsg })).toBeVisible({ timeout: 10000 });
    await parentMessage.hover();

    const threadTrigger = parentMessage.locator('.thread-indicator, .reply-btn, button[title*="thread"], button[title*="reply"], button[title*="Thread"]');
    await expect(threadTrigger.first()).toBeVisible({ timeout: 5000 });
    await threadTrigger.first().click();
    await expect(page.locator('.thread-panel')).toBeVisible({ timeout: 5000 });

    const replyText = `Thread reply persists ${Date.now()}`;
    await page.locator('.thread-panel textarea[placeholder="Reply in thread..."]').fill(replyText);
    await page.locator('.thread-panel button').filter({ hasText: 'Reply' }).click();
    await expect(page.locator('.thread-panel .reply .message-content').filter({ hasText: replyText })).toBeVisible({ timeout: 10000 });

    await page.reload();
    await expect(page).toHaveURL(/\/#\/workspace\//);
    await expect(page.locator('.channel-item').filter({ hasText: 'general' })).toBeVisible({ timeout: 10000 });
    await page.locator('.channel-item').filter({ hasText: 'general' }).click();

    const reloadedParentMessage = page.locator('.message').filter({ hasText: parentMsg }).last();
    await expect(reloadedParentMessage.locator('.message-content').filter({ hasText: parentMsg })).toBeVisible({ timeout: 15000 });
    await expect(reloadedParentMessage.locator('.thread-indicator')).toBeVisible({ timeout: 15000 });
    await expect(reloadedParentMessage.locator('.thread-indicator .thread-count')).toHaveText('1 reply', { timeout: 15000 });
    await expect(page.locator('.message-list .message-content').filter({ hasText: replyText })).toHaveCount(0);
    await reloadedParentMessage.hover();

    const reloadedThreadTrigger = reloadedParentMessage.locator('.thread-indicator, .reply-btn, button[title*="thread"], button[title*="reply"], button[title*="Thread"]');
    await expect(reloadedThreadTrigger.first()).toBeVisible({ timeout: 5000 });
    await reloadedThreadTrigger.first().click();

    await expect(page.locator('.thread-panel')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.thread-panel .reply .message-content').filter({ hasText: replyText })).toBeVisible({ timeout: 15000 });
  });

  test('thread reply appears in another tab and survives reload there', async ({ browser }) => {
    const context = await browser.newContext();
    const page1 = await context.newPage();
    const page2 = await context.newPage();

    await loginViaUI(page1, email, password);
    await loginViaUI(page2, email, password);

    await page1.locator('.workspace-list li a').first().click();
    await page2.locator('.workspace-list li a').first().click();
    await expect(page1.locator('.channel-item').filter({ hasText: 'general' })).toBeVisible();
    await expect(page2.locator('.channel-item').filter({ hasText: 'general' })).toBeVisible();
    await page1.locator('.channel-item').filter({ hasText: 'general' }).click();
    await page2.locator('.channel-item').filter({ hasText: 'general' }).click();

    const parentMsg = `Thread cross-tab parent ${Date.now()}`;
    await page1.locator('textarea[placeholder="Type a message..."]').fill(parentMsg);
    await page1.locator('button').filter({ hasText: /^Send$/ }).click();

    const page1ParentMessage = page1.locator('.message').filter({ hasText: parentMsg }).last();
    const page2ParentMessage = page2.locator('.message').filter({ hasText: parentMsg }).last();
    await expect(page1ParentMessage.locator('.message-content').filter({ hasText: parentMsg })).toBeVisible({ timeout: 10000 });
    await expect(page2ParentMessage.locator('.message-content').filter({ hasText: parentMsg })).toBeVisible({ timeout: 15000 });

    await page1ParentMessage.hover();
    await page2ParentMessage.hover();

    const page1ThreadTrigger = page1ParentMessage.locator('.thread-indicator, .reply-btn, button[title*="thread"], button[title*="reply"], button[title*="Thread"]');
    const page2ThreadTrigger = page2ParentMessage.locator('.thread-indicator, .reply-btn, button[title*="thread"], button[title*="reply"], button[title*="Thread"]');
    await expect(page1ThreadTrigger.first()).toBeVisible({ timeout: 5000 });
    await expect(page2ThreadTrigger.first()).toBeVisible({ timeout: 5000 });
    await page1ThreadTrigger.first().click();
    await page2ThreadTrigger.first().click();

    await expect(page1.locator('.thread-panel')).toBeVisible({ timeout: 5000 });
    await expect(page2.locator('.thread-panel')).toBeVisible({ timeout: 5000 });

    const replyText = `Thread cross-tab reply ${Date.now()}`;
    await page1.locator('.thread-panel textarea[placeholder="Reply in thread..."]').fill(replyText);
    await page1.locator('.thread-panel button').filter({ hasText: 'Reply' }).click();

    await expect(page1.locator('.thread-panel .reply .message-content').filter({ hasText: replyText })).toBeVisible({ timeout: 10000 });
    await expect(page2.locator('.thread-panel .reply .message-content').filter({ hasText: replyText })).toBeVisible({ timeout: 15000 });

    await page2.reload();
    await expect(page2).toHaveURL(/\/#\/workspace\//);
    await expect(page2.locator('.channel-item').filter({ hasText: 'general' })).toBeVisible({ timeout: 10000 });
    await page2.locator('.channel-item').filter({ hasText: 'general' }).click();

    const reloadedParentMessage = page2.locator('.message').filter({ hasText: parentMsg }).last();
    await expect(reloadedParentMessage.locator('.message-content').filter({ hasText: parentMsg })).toBeVisible({ timeout: 15000 });
    await expect(reloadedParentMessage.locator('.thread-indicator')).toBeVisible({ timeout: 15000 });
    await expect(reloadedParentMessage.locator('.thread-indicator .thread-count')).toHaveText('1 reply', { timeout: 15000 });
    await expect(page2.locator('.message-list .message-content').filter({ hasText: replyText })).toHaveCount(0);
    await reloadedParentMessage.hover();

    const reloadedThreadTrigger = reloadedParentMessage.locator('.thread-indicator, .reply-btn, button[title*="thread"], button[title*="reply"], button[title*="Thread"]');
    await expect(reloadedThreadTrigger.first()).toBeVisible({ timeout: 5000 });
    await reloadedThreadTrigger.first().click();

    await expect(page2.locator('.thread-panel')).toBeVisible({ timeout: 5000 });
    await expect(page2.locator('.thread-panel .reply .message-content').filter({ hasText: replyText })).toBeVisible({ timeout: 15000 });

    await context.close();
  });
});
