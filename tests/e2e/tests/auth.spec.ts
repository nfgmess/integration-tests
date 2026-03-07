import { test, expect } from '@playwright/test';
import { randomEmail, randomName, registerViaUI, loginViaUI } from './helpers';

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
    const name = randomName();

    // Register first via UI
    await registerViaUI(page, name, email, 'SecurePass123!');

    // Logout
    await page.locator('button').filter({ hasText: 'Logout' }).click();
    await expect(page).toHaveURL(/\/#\/login/);

    // Login
    await loginViaUI(page, email, 'SecurePass123!');
    await expect(page.locator('h2')).toContainText('Your Workspaces');
  });

  test('login with wrong password shows error', async ({ page }) => {
    const email = randomEmail();
    await registerViaUI(page, randomName(), email, 'SecurePass123!');

    // Logout
    await page.locator('button').filter({ hasText: 'Logout' }).click();

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
    await registerViaUI(page, randomName(), randomEmail(), 'SecurePass123!');
    await page.locator('button').filter({ hasText: 'Logout' }).click();
    await expect(page).toHaveURL(/\/#\/login/);
  });
});
