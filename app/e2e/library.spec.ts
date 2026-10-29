import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { bookPath, importBooks, openCard, waitForCards, waitReaderReady } from './helpers';

/** 模拟把文件拖进窗口：构造带 Files 的 DataTransfer，依次派发 dragenter、dragover、drop */
async function dropFiles(page: Page, files: string[], opts: { hold?: boolean } = {}): Promise<void> {
  const payload = files.map((f) => ({ name: f.split(/[\\/]/).pop()!, base64: fs.readFileSync(f).toString('base64') }));
  await page.evaluate(
    async ({ payload, hold }) => {
      const dt = new DataTransfer();
      for (const p of payload) {
        const bytes = Uint8Array.from(atob(p.base64), (c) => c.charCodeAt(0));
        dt.items.add(new File([bytes], p.name));
      }
      const fire = (type: string): void => {
        window.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
      };
      fire('dragenter');
      fire('dragover');
      if (!hold) fire('drop');
    },
    { payload, hold: !!opts.hold },
  );
}

test.describe('书库', () => {
  test('空书库的提示；拖入文件时出现虚线框，放下后导入', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('empty-library')).toContainText('把繁体书拖到这里');
    await expect(page.getByTestId('empty-library')).toContainText('支持 epub、mobi、azw3、fb2、txt');

    await dropFiles(page, [bookPath('tw-sample.fb2')], { hold: true });
    await expect(page.getByTestId('drop-overlay')).toBeVisible();
    // 离开窗口，虚线框消失
    await page.evaluate(() => window.dispatchEvent(new DragEvent('dragleave', { bubbles: true })));
    await expect(page.getByTestId('drop-overlay')).toHaveCount(0);

    await dropFiles(page, [bookPath('tw-sample.fb2'), bookPath('tw-sample.mobi')]);
    await waitForCards(page, 2);
    await expect(page.getByTestId('drop-overlay')).toHaveCount(0);
    await expect(page.getByTestId('empty-library')).toHaveCount(0);
  });

  test('一次选多个文件；不支持的格式给出提示；重复导入去重', async ({ page }) => {
    await page.goto('/');
    const pdf = path.join(os.tmpdir(), 'not-a-book.pdf');
    fs.writeFileSync(pdf, '%PDF-1.4\n');
    try {
      await importBooks(page, [bookPath('tw-sample.azw3'), bookPath('tw-big5.txt'), pdf]);
      await waitForCards(page, 2);
      await expect(page.getByText(/不支持的格式：not-a-book\.pdf/)).toBeVisible();
      await importBooks(page, [bookPath('tw-big5.txt')]);
      await expect(page.getByText('1 本已在书库中')).toBeVisible();
      await waitForCards(page, 2);
    } finally {
      fs.rmSync(pdf, { force: true });
    }
  });

  test('损坏的文件：给出错误提示，书库里不会多出一本打不开的书', async ({ page }) => {
    await page.goto('/');
    const bad = path.join(os.tmpdir(), 'broken.epub');
    fs.writeFileSync(bad, Buffer.from('这不是一个 epub，只是一些随便写的字节'));
    try {
      await importBooks(page, [bad]);
      await expect(page.getByRole('alert').filter({ hasText: 'broken.epub' })).toBeVisible();
      await expect(page.getByTestId('book-card')).toHaveCount(0);
      await expect(page.getByTestId('empty-library')).toBeVisible();
    } finally {
      fs.rmSync(bad, { force: true });
    }
  });

  test('Ctrl+O 打开文件选择器', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('empty-library')).toBeVisible(); // 页面和快捷键都就绪了
    const chooser = page.waitForEvent('filechooser');
    await page.keyboard.press('Control+o');
    await (await chooser).setFiles([bookPath('tw-sample.fb2')]);
    await waitForCards(page, 1);
  });

  test('排序方式；卡片菜单：显示原文/显示简体；从书库移除要确认', async ({ page }) => {
    await page.goto('/');
    await importBooks(page, [bookPath('tw-sample.fb2')]);
    await waitForCards(page, 1);
    await importBooks(page, [bookPath('tw-vertical.epub')]);
    await waitForCards(page, 2);

    // 书名排序
    await page.getByRole('button', { name: '更多' }).first().click();
    await page.getByRole('menuitemradio', { name: '书名' }).click();
    const titles = await page.getByTestId('book-card').locator('.g-title').allTextContents();
    expect(titles).toHaveLength(2);
    expect([...titles].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))).toEqual(titles);

    // 卡片菜单：显示原文
    const card = page.getByTestId('book-card').filter({ hasText: '软件与网络的故事' });
    await expect(card.locator('.cover')).toContainText('软件与网络的故事');
    await card.getByRole('button', { name: '更多' }).click();
    await page.getByRole('menuitem', { name: '显示原文' }).click();
    await expect(page.getByTestId('book-card').filter({ hasText: '軟體與網路的故事' })).toHaveCount(1);
    // 原文状态下再点开，阅读器里也是原文（按书记住）
    await openCard(page, /打开《軟體與網路的故事》/);
    await expect(page.getByTestId('reader')).toHaveAttribute('data-display', 'original');
    await expect(page.getByTestId('book-title')).toHaveText('軟體與網路的故事');
    await page.mouse.move(640, 20);
    await page.getByRole('button', { name: '返回书库' }).click();
    await waitForCards(page, 2);
    await page.getByTestId('book-card').filter({ hasText: '軟體與網路的故事' }).getByRole('button', { name: '更多' }).click();
    await page.getByRole('menuitem', { name: '显示简体' }).click();
    await expect(page.getByTestId('book-card').filter({ hasText: '软件与网络的故事' })).toHaveCount(1);

    // 移除：先确认，取消不删
    await page.getByTestId('book-card').filter({ hasText: '软件与网络的故事' }).getByRole('button', { name: '更多' }).click();
    await page.getByRole('menuitem', { name: /从书库移除/ }).click();
    await expect(page.getByRole('dialog')).toContainText('从书库移除？');
    await page.getByRole('button', { name: '取消' }).click();
    await waitForCards(page, 2);
    await page.getByTestId('book-card').filter({ hasText: '软件与网络的故事' }).getByRole('button', { name: '更多' }).click();
    await page.getByRole('menuitem', { name: /从书库移除/ }).click();
    await page.getByRole('button', { name: '移除' }).click();
    await waitForCards(page, 1);
    // 刷新后仍然只剩一本
    await page.reload();
    await waitForCards(page, 1);
  });

  test('刷新后书库还在，封面、进度都在', async ({ page }) => {
    await page.goto('/');
    await importBooks(page, [bookPath('tw-sample.mobi')]);
    await waitForCards(page, 1);
    await page.reload();
    await waitForCards(page, 1);
    await expect(page.getByTestId('book-card').getByText('新增')).toBeVisible();
    await openCard(page, /打开《/);
    await waitReaderReady(page);
  });
});
