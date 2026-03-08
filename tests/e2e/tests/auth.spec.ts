import { test, expect } from '@playwright/test';
import { randomEmail, randomName, registerViaUI, loginViaUI, registerUserViaApi } from './helpers';

test.describe('Authentication', () => {
  test('register a new user through UI', async ({ page }) => {
    const email = randomEmail();
    const name = randomName();

    await registerViaUI(page, name, email, 'SecurePass123!');

    // Should see workspace list (home page)
    await expect(page.locator('h2')).toContainText('Your Workspaces');
  });

  test('login with valid credentials', async ({ page }) => {
    const email = randomEmail();
    const password = 'SecurePass123!';

    await registerUserViaApi(email, password, randomName());

    // Login
    await loginViaUI(page, email, password);
    await expect(page.locator('h2')).toContainText('Your Workspaces');
  });

  test('login with wrong password shows error', async ({ page }) => {
    const email = randomEmail();
    await registerUserViaApi(email, 'SecurePass123!', randomName());

    // Try wrong password
    await page.goto('/#/login');
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill('WrongPass999!');
    await page.locator('button[type="submit"]').click();

    await expect(page.locator('.error')).toBeVisible();
  });

  test('register with mismatched passwords shows error', async ({ page }) => {
    await page.goto('/#/register');
    await page.locator('input[type="text"]').fill(randomName());
    await page.locator('input[type="email"]').fill(randomEmail());
    await page.locator('input[type="password"]').first().fill('SecurePass123!');
    await page.locator('input[type="password"]').nth(1).fill('DifferentPass!');
    await page.locator('button[type="submit"]').click();

    await expect(page.locator('.error')).toBeVisible();
  });

  test('logout returns to login page', async ({ page }) => {
    const email = randomEmail();
    const password = 'SecurePass123!';
    await registerUserViaApi(email, password, randomName());
    await loginViaUI(page, email, password);
    await page.locator('button').filter({ hasText: 'Logout' }).click();
    await expect(page).toHaveURL(/\/#\/login/);
  });
});
