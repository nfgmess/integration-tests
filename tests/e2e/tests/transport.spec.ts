import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import {
  randomEmail,
  randomName,
  randomWorkspaceName,
  registerUserViaApi,
  createWorkspaceViaApi,
  loginViaUI,
} from './helpers';
const { measureE2E } = require('./perf.cjs');

type TransportAudit = {
  webTransportUrls: string[];
  webTransportReady: number;
  webTransportErrors: string[];
  webSocketUrls: string[];
};

async function installTransportAudit(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const globalWindow = window as typeof window & {
      __transportAudit?: {
        webTransportUrls: string[];
        webTransportReady: number;
        webTransportErrors: string[];
        webSocketUrls: string[];
      };
      WebTransport?: typeof WebTransport;
      WebSocket: typeof WebSocket;
    };

    globalWindow.__transportAudit = {
      webTransportUrls: [],
      webTransportReady: 0,
      webTransportErrors: [],
      webSocketUrls: [],
    };

    const audit = globalWindow.__transportAudit;
    const OriginalWebTransport = globalWindow.WebTransport;
    if (typeof OriginalWebTransport !== 'undefined') {
      globalWindow.WebTransport = new Proxy(OriginalWebTransport, {
        construct(target, args, newTarget) {
          audit.webTransportUrls.push(String(args[0] ?? ''));
          const instance = Reflect.construct(target, args, newTarget) as WebTransport;
          Promise.resolve(instance.ready)
            .then(() => {
              audit.webTransportReady += 1;
            })
            .catch((error: unknown) => {
              audit.webTransportErrors.push(String(error));
            });
          return instance;
        },
      });
    }

    const OriginalWebSocket = globalWindow.WebSocket;
    globalWindow.WebSocket = new Proxy(OriginalWebSocket, {
      construct(target, args, newTarget) {
        audit.webSocketUrls.push(String(args[0] ?? ''));
        return Reflect.construct(target, args, newTarget);
      },
    });
  });
}

async function getTransportAudit(page: Page): Promise<TransportAudit> {
  return page.evaluate(() => {
    const globalWindow = window as typeof window & {
      __transportAudit?: TransportAudit;
    };
    return globalWindow.__transportAudit ?? {
      webTransportUrls: [],
      webTransportReady: 0,
      webTransportErrors: [],
      webSocketUrls: [],
    };
  });
}

function gatewayWebSocketUrls(urls: string[]): string[] {
  return urls.filter((url) => /:8443\/ws\b/.test(url) || /\/ws\b/.test(url));
}

async function expectWebTransportOnly(page: Page, consoleLogs: string[]): Promise<void> {
  await expect
    .poll(
      async () => {
        const audit = await getTransportAudit(page);
        return {
          webTransportReady: audit.webTransportReady,
          webTransportErrors: audit.webTransportErrors,
          gatewayWebSocketUrls: gatewayWebSocketUrls(audit.webSocketUrls),
        };
      },
      {
      timeout: 15000,
      message: 'expected either a ready WebTransport session or a concrete fallback signal',
    },
    )
    .not.toEqual({
      webTransportReady: 0,
      webTransportErrors: [],
      gatewayWebSocketUrls: [],
    });

  const audit = await getTransportAudit(page);

  expect(audit.webTransportUrls.length).toBeGreaterThan(0);
  expect(audit.webTransportUrls.some((url) => url.includes('https://localhost:8444/webtransport'))).toBeTruthy();
  expect(gatewayWebSocketUrls(audit.webSocketUrls)).toEqual([]);
  expect(audit.webTransportErrors).toEqual([]);
  expect(audit.webTransportReady).toBeGreaterThan(0);
  expect(
    consoleLogs.some((line) => line.includes('[transport] Connected via WebTransport')),
  ).toBeTruthy();
  expect(
    consoleLogs.some((line) => line.includes('WebTransport failed, falling back to WebSocket')),
  ).toBeFalsy();
}

async function waitForSubscription(consoleLogs: string[]): Promise<void> {
  await expect
    .poll(
      () => consoleLogs.some((line) => line.includes('Subscribed to channel:')),
      {
        timeout: 15000,
        message: 'expected a subscribe acknowledgement from the gateway',
      },
    )
    .toBeTruthy();
}

async function newAuditedPage(browser: Browser): Promise<{
  context: BrowserContext;
  page: Page;
  consoleLogs: string[];
}> {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await installTransportAudit(context);

  const page = await context.newPage();
  const consoleLogs: string[] = [];
  page.on('console', (msg) => consoleLogs.push(msg.text()));

  return { context, page, consoleLogs };
}

test.describe('Transport', () => {
  test('browser uses WebTransport for gateway messaging instead of gateway WebSocket fallback', async ({ browser }) => {
    const perf = test.info();
    const email = randomEmail();
    const password = 'SecurePass123!';
    const auth = await registerUserViaApi(email, password, randomName(), perf);
    await createWorkspaceViaApi(auth.access_token, randomWorkspaceName(), perf);

    const { context, page, consoleLogs } = await newAuditedPage(browser);

    await loginViaUI(page, email, password, perf);
    await page.locator('.workspace-list li a').first().click();
    await expect(page).toHaveURL(/\/#\/workspace\//);
    await expect(page.locator('.channel-item').filter({ hasText: 'general' })).toBeVisible();
    await page.locator('.channel-item').filter({ hasText: 'general' }).click();

    const messageText = `WebTransport only ${Date.now()}`;
    await measureE2E(perf, 'transport.webtransport_send_visible_ui', { phase: 'realtime' }, async () => {
      await page.locator('textarea[placeholder="Type a message..."]').fill(messageText);
      await page.locator('button').filter({ hasText: /^Send$/ }).click();
      await expect(page.locator('.message-content').filter({ hasText: messageText })).toBeVisible({
        timeout: 10000,
      });
    });

    await measureE2E(perf, 'transport.webtransport_reload_restore_ui', { phase: 'reload' }, async () => {
      await page.reload();
      await expect(page).toHaveURL(/\/#\/workspace\//);
      await expect(page.locator('.channel-item').filter({ hasText: 'general' })).toBeVisible();
      await page.locator('.channel-item').filter({ hasText: 'general' }).click();
      await expect(page.locator('.message-content').filter({ hasText: messageText })).toBeVisible({
        timeout: 15000,
      });
    });

    await expectWebTransportOnly(page, consoleLogs);

    await context.close();
  });

  test('cross-tab real-time delivery stays on WebTransport in both tabs', async ({ browser }) => {
    const perf = test.info();
    const email = randomEmail();
    const password = 'SecurePass123!';
    const name = randomName();
    const auth = await registerUserViaApi(email, password, name, perf);
    await createWorkspaceViaApi(auth.access_token, randomWorkspaceName(), perf);

    const auditedPage1 = await newAuditedPage(browser);
    const auditedPage2 = await newAuditedPage(browser);

    await loginViaUI(auditedPage1.page, email, password, perf);
    await loginViaUI(auditedPage2.page, email, password, perf);

    await auditedPage1.page.locator('.workspace-list li a').first().click();
    await auditedPage2.page.locator('.workspace-list li a').first().click();

    await expect(
      auditedPage1.page.locator('.channel-item').filter({ hasText: 'general' }),
    ).toBeVisible();
    await expect(
      auditedPage2.page.locator('.channel-item').filter({ hasText: 'general' }),
    ).toBeVisible();

    await auditedPage1.page.locator('.channel-item').filter({ hasText: 'general' }).click();
    await auditedPage2.page.locator('.channel-item').filter({ hasText: 'general' }).click();
    await waitForSubscription(auditedPage1.consoleLogs);
    await waitForSubscription(auditedPage2.consoleLogs);

    const messageText = `WT realtime ${Date.now()}`;
    await measureE2E(perf, 'transport.webtransport_cross_tab_delivery_ui', { phase: 'realtime' }, async () => {
      await auditedPage1.page.locator('textarea[placeholder="Type a message..."]').fill(messageText);
      await auditedPage1.page.locator('button').filter({ hasText: /^Send$/ }).click();
      await expect(
        auditedPage2.page.locator('.message-content').filter({ hasText: messageText }),
      ).toBeVisible({ timeout: 15000 });
    });

    await expectWebTransportOnly(auditedPage1.page, auditedPage1.consoleLogs);
    await expectWebTransportOnly(auditedPage2.page, auditedPage2.consoleLogs);

    await auditedPage1.context.close();
    await auditedPage2.context.close();
  });
});
