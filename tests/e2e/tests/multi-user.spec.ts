import { test, expect } from '@playwright/test';
import {
  randomEmail, randomName, randomWorkspaceName,
  registerUserViaApi, createWorkspaceViaApi, createInviteViaApi, loginViaUI,
} from './helpers';

test.describe('Multi-user scenarios', () => {
  test('Alice invites Bob, Bob joins workspace', async ({ browser }) => {
    const aliceEmail = randomEmail();
    const alicePassword = 'SecurePass123!';
    const aliceAuth = await registerUserViaApi(aliceEmail, alicePassword, 'Alice');
    const ws = await createWorkspaceViaApi(aliceAuth.access_token, randomWorkspaceName());
    const invite = await createInviteViaApi(aliceAuth.access_token, ws.workspace_id);

    const bobEmail = randomEmail();
    const bobPassword = 'SecurePass123!';
    await registerUserViaApi(bobEmail, bobPassword, 'Bob');

    // Bob opens invite link
    const bobContext = await browser.newContext();
    const bobPage = await bobContext.newPage();
    await loginViaUI(bobPage, bobEmail, bobPassword);

    // Bob accepts invite via URL
    await bobPage.goto(`/#/invite/${invite.invite_code}`);

    // Bob should end up in the workspace
    await expect(bobPage).toHaveURL(/\/#\/workspace\//, { timeout: 15000 });
    await expect(bobPage.locator('.channel-item').filter({ hasText: 'general' })).toBeVisible({ timeout: 10000 });

    await bobContext.close();
  });

  test('Alice sends message to Bob in real-time', async ({ browser }) => {
    // Setup via API
    const aliceEmail = randomEmail();
    const alicePassword = 'SecurePass123!';
    const aliceAuth = await registerUserViaApi(aliceEmail, alicePassword, 'Alice');
    const ws = await createWorkspaceViaApi(aliceAuth.access_token, randomWorkspaceName());
    const invite = await createInviteViaApi(aliceAuth.access_token, ws.workspace_id);

    const bobEmail = randomEmail();
    const bobPassword = 'SecurePass123!';
    const bobAuth = await registerUserViaApi(bobEmail, bobPassword, 'Bob');

    // Bob accepts invite via API
    await fetch(`http://localhost:8081/api/v1/invites/${invite.invite_code}/accept`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${bobAuth.access_token}` },
    });

    // Open two browser sessions
    const aliceCtx = await browser.newContext();
    const bobCtx = await browser.newContext();
    const alicePage = await aliceCtx.newPage();
    const bobPage = await bobCtx.newPage();

    await loginViaUI(alicePage, aliceEmail, alicePassword);
    await loginViaUI(bobPage, bobEmail, bobPassword);

    // Both navigate to workspace
    await alicePage.locator('.workspace-list li a').first().click();
    await bobPage.locator('.workspace-list li a').first().click();

    // Both click #general
    await expect(alicePage.locator('.channel-item').filter({ hasText: 'general' })).toBeVisible();
    await expect(bobPage.locator('.channel-item').filter({ hasText: 'general' })).toBeVisible();
    await alicePage.locator('.channel-item').filter({ hasText: 'general' }).click();
    await bobPage.locator('.channel-item').filter({ hasText: 'general' }).click();

    // Alice sends a message
    const msg = `Hello Bob from Alice! ${Date.now()}`;
    await alicePage.locator('textarea[placeholder="Type a message..."]').fill(msg);
    await alicePage.locator('button').filter({ hasText: /^Send$/ }).click();

    // Bob should see it
    await expect(bobPage.locator('.message-content').filter({ hasText: msg })).toBeVisible({ timeout: 15000 });

    await aliceCtx.close();
    await bobCtx.close();
  });

  test('create DM between two users', async ({ browser }) => {
    // Setup
    const aliceEmail = randomEmail();
    const alicePassword = 'SecurePass123!';
    const aliceAuth = await registerUserViaApi(aliceEmail, alicePassword, 'Alice DM');
    const ws = await createWorkspaceViaApi(aliceAuth.access_token, randomWorkspaceName());
    const invite = await createInviteViaApi(aliceAuth.access_token, ws.workspace_id);

    const bobEmail = randomEmail();
    const bobPassword = 'SecurePass123!';
    const bobAuth = await registerUserViaApi(bobEmail, bobPassword, 'Bob DM');
    await fetch(`http://localhost:8081/api/v1/invites/${invite.invite_code}/accept`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${bobAuth.access_token}` },
    });

    // Alice opens browser
    const aliceCtx = await browser.newContext();
    const alicePage = await aliceCtx.newPage();
    await loginViaUI(alicePage, aliceEmail, alicePassword);

    await alicePage.locator('.workspace-list li a').first().click();
    await expect(alicePage).toHaveURL(/\/#\/workspace\//);

    // Click "New message" (DM)
    await alicePage.locator('button[title="New message"]').click();

    // Search for Bob
    await alicePage.locator('.search-inline').fill('Bob DM');
    await expect(alicePage.locator('.user-result').filter({ hasText: 'Bob DM' })).toBeVisible({ timeout: 10000 });
    await alicePage.locator('.user-result').filter({ hasText: 'Bob DM' }).click();

    // Start conversation
    await alicePage.locator('.start-btn').click();

    // Should switch to DM channel
    await expect(alicePage.locator('.header-name')).toContainText('Bob DM', { timeout: 10000 });

    // Send a DM
    const dmMsg = `DM to Bob ${Date.now()}`;
    await alicePage.locator('textarea[placeholder="Type a message..."]').fill(dmMsg);
    await alicePage.locator('button').filter({ hasText: /^Send$/ }).click();
    await expect(alicePage.locator('.message-content').filter({ hasText: dmMsg })).toBeVisible({ timeout: 10000 });

    await aliceCtx.close();
  });
});
