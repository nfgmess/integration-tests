import { test, expect } from '@playwright/test';
import {
  randomEmail, randomName, randomWorkspaceName,
  registerUserViaApi, createWorkspaceViaApi, createInviteViaApi, joinWorkspaceViaApi,
  createDmViaApi, loginViaUI,
} from './helpers';
const { measureE2E } = require('./perf.cjs');

test.describe('Multi-user scenarios', () => {
  test('Alice invites Bob, Bob joins workspace', async ({ browser }) => {
    const perf = test.info();
    const aliceEmail = randomEmail();
    const alicePassword = 'SecurePass123!';
    const aliceAuth = await registerUserViaApi(aliceEmail, alicePassword, 'Alice', perf);
    const ws = await createWorkspaceViaApi(aliceAuth.access_token, randomWorkspaceName(), perf);
    const invite = await createInviteViaApi(aliceAuth.access_token, ws.workspace_id, perf);

    const bobEmail = randomEmail();
    const bobPassword = 'SecurePass123!';
    await registerUserViaApi(bobEmail, bobPassword, 'Bob', perf);

    // Bob opens invite link
    const bobContext = await browser.newContext();
    const bobPage = await bobContext.newPage();
    await loginViaUI(bobPage, bobEmail, bobPassword, perf);

    await measureE2E(perf, 'workspace.invite_accept_ui', { phase: 'join' }, async () => {
      await bobPage.goto(`/#/invite/${invite.invite_code}`);
      await expect(bobPage).toHaveURL(/\/#\/workspace\//, { timeout: 15000 });
      await expect(bobPage.locator('.channel-item').filter({ hasText: 'general' })).toBeVisible({ timeout: 10000 });
    });

    await bobContext.close();
  });

  test('Alice sends message to Bob in real-time', async ({ browser }) => {
    const perf = test.info();
    // Setup via API
    const aliceEmail = randomEmail();
    const alicePassword = 'SecurePass123!';
    const aliceAuth = await registerUserViaApi(aliceEmail, alicePassword, 'Alice', perf);
    const ws = await createWorkspaceViaApi(aliceAuth.access_token, randomWorkspaceName(), perf);
    const invite = await createInviteViaApi(aliceAuth.access_token, ws.workspace_id, perf);

    const bobEmail = randomEmail();
    const bobPassword = 'SecurePass123!';
    const bobAuth = await registerUserViaApi(bobEmail, bobPassword, 'Bob', perf);

    // Bob joins workspace via API
    await joinWorkspaceViaApi(bobAuth.access_token, ws.workspace_id, invite.invite_code, perf);

    // Open two browser sessions
    const aliceCtx = await browser.newContext();
    const bobCtx = await browser.newContext();
    const alicePage = await aliceCtx.newPage();
    const bobPage = await bobCtx.newPage();

    await loginViaUI(alicePage, aliceEmail, alicePassword, perf);
    await loginViaUI(bobPage, bobEmail, bobPassword, perf);

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
    await measureE2E(perf, 'messaging.multi_user_delivery_ui', { phase: 'realtime' }, async () => {
      await alicePage.locator('textarea[placeholder="Type a message..."]').fill(msg);
      await alicePage.locator('button').filter({ hasText: /^Send$/ }).click();
      const bobMessage = bobPage.locator('.message').filter({ hasText: msg }).last();
      await expect(bobMessage.locator('.message-content').filter({ hasText: msg })).toBeVisible({ timeout: 15000 });
      await expect(bobMessage.locator('.sender')).toHaveText('Alice', { timeout: 15000 });
    });

    await measureE2E(perf, 'messaging.multi_user_reload_restore_ui', { phase: 'reload' }, async () => {
      await bobPage.reload();
      await expect(bobPage).toHaveURL(/\/#\/workspace\//);
      await expect(bobPage.locator('.channel-item').filter({ hasText: 'general' })).toBeVisible({ timeout: 10000 });
      await bobPage.locator('.channel-item').filter({ hasText: 'general' }).click();
      const bobMessageAfterReload = bobPage.locator('.message').filter({ hasText: msg }).last();
      await expect(bobMessageAfterReload.locator('.message-content').filter({ hasText: msg })).toBeVisible({ timeout: 15000 });
      await expect(bobMessageAfterReload.locator('.sender')).toHaveText('Alice', { timeout: 15000 });
    });

    await aliceCtx.close();
    await bobCtx.close();
  });

  test('send a DM between two users', async ({ browser }) => {
    const perf = test.info();
    // Setup
    const aliceEmail = randomEmail();
    const alicePassword = 'SecurePass123!';
    const aliceAuth = await registerUserViaApi(aliceEmail, alicePassword, 'Alice DM', perf);
    const ws = await createWorkspaceViaApi(aliceAuth.access_token, randomWorkspaceName(), perf);
    const invite = await createInviteViaApi(aliceAuth.access_token, ws.workspace_id, perf);

    const bobEmail = randomEmail();
    const bobPassword = 'SecurePass123!';
    const bobAuth = await registerUserViaApi(bobEmail, bobPassword, 'Bob DM', perf);
    await joinWorkspaceViaApi(bobAuth.access_token, ws.workspace_id, invite.invite_code, perf);

    const dm = await createDmViaApi(aliceAuth.access_token, ws.workspace_id, [bobAuth.user_id], perf);

    // Open both browsers on the same workspace
    const aliceCtx = await browser.newContext();
    const bobCtx = await browser.newContext();
    const alicePage = await aliceCtx.newPage();
    const bobPage = await bobCtx.newPage();
    await loginViaUI(alicePage, aliceEmail, alicePassword, perf);
    await loginViaUI(bobPage, bobEmail, bobPassword, perf);

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
    await measureE2E(perf, 'dm.delivery_ui', { phase: 'realtime' }, async () => {
      await alicePage.locator('textarea[placeholder="Type a message..."]').fill(dmMsg);
      await alicePage.locator('button').filter({ hasText: /^Send$/ }).click();
      await expect(alicePage.locator('.message-content').filter({ hasText: dmMsg })).toBeVisible({ timeout: 10000 });
      await expect(bobPage.locator('.message-content').filter({ hasText: dmMsg })).toBeVisible({ timeout: 15000 });
    });

    await aliceCtx.close();
    await bobCtx.close();
  });
});
