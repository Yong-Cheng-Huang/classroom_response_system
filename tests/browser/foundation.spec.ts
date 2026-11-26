import { test, expect } from '@playwright/test';

test('1.4 同一Chrome context的多分頁均可載入React並連接同來源後端', async ({ context }) => {
  const pages = await Promise.all(Array.from({ length: 3 }, () => context.newPage()));
  for (const page of pages) {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '課堂搶答系統', exact: true })).toBeVisible();
    await expect(page.getByRole('status')).toHaveText('本機服務已連線');
  }
  expect(context.pages()).toHaveLength(3);
  await pages[0]!.reload();
  await expect(pages[0]!.getByRole('status')).toHaveText('本機服務已連線');
  await pages[0]!.screenshot({ path: 'test-results/foundation.png', fullPage: true });
  // 只驗證測試入口與基礎頁面，沒有驗證／實作 G1 或42分頁效能。
});
