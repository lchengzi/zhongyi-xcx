import { test, expect } from '@playwright/test';

test.use({ baseURL: 'http://127.0.0.1:4312' });

test('anonymous browser can read only the frozen reference, not the editorial workspace', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '登录工作台' })).toBeVisible();
  const response = await context.request.get('/api/v1/public/catalog');
  expect(response.status()).toBe(200); expect(response.headers()['cache-control']).toBe('no-store');
  const body = await response.json(); expect(body.items).toHaveLength(106);
  expect(Object.keys(body).sort()).toEqual(['schemaVersion', 'purpose', 'releaseId', 'releaseDigest', 'contentVersion', 'sourceAsOf', 'items'].sort());
  expect(body.sourceAsOf).toBe('2026-08-10');
  expect(body.items.find((item: { id: string }) => item.id === 'huang-qi').professionalReviewState).toBe('pending');
  expect((await context.request.get('/api/v1/editorial/sources')).status()).toBe(401);
  expect((await context.request.get('/api/v1/users')).status()).toBe(401);
  expect((await context.request.get('/api/v1/public/editorial/sources')).status()).toBe(404);
  expect((await context.request.get('/api/v1/public/catalog?q=hidden-health')).status()).toBe(400);
  expect((await context.request.post('/api/v1/public/catalog', { data: { professionalReviewState: 'reviewed' } })).status()).toBe(404);
  await expect(page.getByRole('button', { name: '登录工作台' })).toBeVisible();
});
