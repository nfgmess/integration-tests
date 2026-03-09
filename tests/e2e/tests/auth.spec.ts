import { test, expect } from '@playwright/test';
import { randomEmail, randomName, registerViaUI, loginViaUI, registerUserViaApi } from './helpers';
const { measureE2E } = require('./perf.cjs');

test.describe('Authentication', () => {
  test('register a new user through UI', async ({ page }) => {
    const email = randomEmail();
    const name = randomName();
    const perf = test.info();

    await registerViaUI(page, name, email, 'SecurePass123!', perf);

    // Should see workspace list (home page)
    await expect(page.locator('h2')).toContainText('Your Workspaces');
  });

  test('login with valid credentials', async ({ page }) => {
    const email = randomEmail();
    const password = 'SecurePass123!';
    const perf = test.info();

    await registerUserViaApi(email, password, randomName(), perf);

    // Login
    await loginViaUI(page, email, password, perf);
    await expect(page.locator('h2')).toContainText('Your Workspaces');
  });

  test('login with wrong password shows error', async ({ page }) => {
    const email = randomEmail();
    const perf = test.info();
    await registerUserViaApi(email, 'SecurePass123!', randomName(), perf);

    await measureE2E(perf, 'auth.login_error_ui', { phase: 'ui' }, async () => {
      await page.goto('/#/login');
      await page.locator('input[type="email"]').fill(email);
      await page.locator('input[type="password"]').fill('WrongPass999!');
      await page.locator('button[type="submit"]').click();
      await expect(page.locator('.error')).toBeVisible();
    });
  });

  test('register with mismatched passwords shows error', async ({ page }) => {
    const perf = test.info();
    await measureE2E(perf, 'auth.register_error_ui', { phase: 'ui' }, async () => {
      await page.goto('/#/register');
      await page.locator('input[type="text"]').fill(randomName());
      await page.locator('input[type="email"]').fill(randomEmail());
      await page.locator('input[type="password"]').first().fill('SecurePass123!');
      await page.locator('input[type="password"]').nth(1).fill('DifferentPass!');
      await page.locator('button[type="submit"]').click();
      await expect(page.locator('.error')).toBeVisible();
    });
  });

  test('logout returns to login page', async ({ page }) => {
    const email = randomEmail();
    const password = 'SecurePass123!';
    const perf = test.info();
    await registerUserViaApi(email, password, randomName(), perf);
    await loginViaUI(page, email, password, perf);
    await measureE2E(perf, 'auth.logout_ui', { phase: 'ui' }, async () => {
      await page.locator('button').filter({ hasText: 'Logout' }).click();
      await expect(page).toHaveURL(/\/#\/login/);
    });
  });
});
