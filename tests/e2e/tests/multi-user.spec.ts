import { test, expect } from '@playwright/test';
import {
  randomEmail, randomName, randomWorkspaceName,
  registerUserViaApi, createWorkspaceViaApi, createInviteViaApi, joinWorkspaceViaApi,
  createDmViaApi, loginViaUI,
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

    // Bob joins workspace via API
    await joinWorkspaceViaApi(bobAuth.access_token, ws.workspace_id, invite.invite_code);

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

  test('send a DM between two users', async ({ browser }) => {
    // Setup
    const aliceEmail = randomEmail();
    const alicePassword = 'SecurePass123!';
    const aliceAuth = await registerUserViaApi(aliceEmail, alicePassword, 'Alice DM');
    const ws = await createWorkspaceViaApi(aliceAuth.access_token, randomWorkspaceName());
    const invite = await createInviteViaApi(aliceAuth.access_token, ws.workspace_id);

    const bobEmail = randomEmail();
    const bobPassword = 'SecurePass123!';
    const bobAuth = await registerUserViaApi(bobEmail, bobPassword, 'Bob DM');
    await joinWorkspaceViaApi(bobAuth.access_token, ws.workspace_id, invite.invite_code);

    const dm = await createDmViaApi(aliceAuth.access_token, ws.workspace_id, [bobAuth.user_id]);

    // Open both browsers on the same workspace
    const aliceCtx = await browser.newContext();
    const bobCtx = await browser.newContext();
    const alicePage = await aliceCtx.newPage();
    const bobPage = await bobCtx.newPage();
    await loginViaUI(alicePage, aliceEmail, alicePassword);
    await loginViaUI(bobPage, bobEmail, bobPassword);

    await alicePage.locator('.workspace-list li a').first().click();
    await bobPage.locator('.workspace-list li a').first().click();
    await expect(alicePage).toHaveURL(/\/#\/workspace\//);
    await expect(bobPage).toHaveURL(/\/#\/workspace\//);

    const aliceDm = alicePage.locator('.channel-item.dm-item').filter({ hasText: dm.name });
    const bobDm = bobPage.locator('.channel-item.dm-item').filter({ hasText: dm.name });
    await expect(aliceDm).toBeVisible({ timeout: 10000 });
    await expect(bobDm).toBeVisible({ timeout: 10000 });

    await aliceDm.click();
    await bobDm.click();
    await expect(alicePage.locator('.header-name')).toContainText(dm.name, { timeout: 10000 });
    await expect(bobPage.locator('.header-name')).toContainText(dm.name, { timeout: 10000 });

    // Send a DM
    const dmMsg = `DM to Bob ${Date.now()}`;
    await alicePage.locator('textarea[placeholder="Type a message..."]').fill(dmMsg);
    await alicePage.locator('button').filter({ hasText: /^Send$/ }).click();
    await expect(alicePage.locator('.message-content').filter({ hasText: dmMsg })).toBeVisible({ timeout: 10000 });
    await expect(bobPage.locator('.message-content').filter({ hasText: dmMsg })).toBeVisible({ timeout: 15000 });

    await aliceCtx.close();
    await bobCtx.close();
  });
});
