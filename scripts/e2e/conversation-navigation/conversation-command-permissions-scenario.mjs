import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { createEvidence } from '../../test-runner/features/acceptance-evidence/createEvidence.mjs';

const tierButton = '[data-conversation-permission-select] button.select-trigger';

export async function runConversationCommandPermissionsScenario({
  cdp, evaluate, waitFor, clickConversation, startNewConversationDraft, openNodeDatabase, workspaceRoot,
}) {
  const evidence = createEvidence('conversation-command-permissions', {
    files: [
      'scripts/e2e/conversation-navigation/conversation-command-permissions-scenario.mjs',
      'scripts/e2e/conversation-navigation/run-electron-conversation-navigation-e2e.mjs',
    ],
  });
  const page = expression => evaluate(cdp, expression);
  const readTier = () => page(`document.querySelector(${JSON.stringify(tierButton)})?.textContent?.trim()`);
  const expectTier = label => waitFor(async () => await readTier() === label, `输入框显示 ${label}`);
  const click = async selector => {
    await waitFor(() => page(`(() => {
      const target = document.querySelector(${JSON.stringify(selector)});
      if (!(target instanceof HTMLElement) || target.matches(':disabled')) return false;
      target.click();
      return true;
    })()`), selector);
  };
  const clickTierButton = async () => {
    const point = await waitFor(() => page(`(() => {
      const button = document.querySelector(${JSON.stringify(tierButton)});
      if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
      const rect = button.getBoundingClientRect();
      const x = rect.x + rect.width / 2;
      const y = rect.y + rect.height / 2;
      return button.contains(document.elementFromPoint(x, y)) && { x, y };
    })()`), '底栏权限入口可由鼠标访问');
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
  };
  const clickOption = async text => {
    await clickTierButton();
    await waitFor(() => page(`(() => {
      const option = [...document.querySelectorAll('[role="option"]')]
        .find(el => el.textContent?.trim() === ${JSON.stringify(text)} && el.getBoundingClientRect().width > 0);
      if (!(option instanceof HTMLElement)) return false;
      option.click();
      return true;
    })()`), `选择 ${text}`);
  };
  const screenshot = async filename => {
    // 截图避开入场动画，行为断言仍由 DOM 与持久事实决定。
    await delay(300);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const path = join(workspaceRoot, filename);
    writeFileSync(path, Buffer.from(data, 'base64'));
    evidence.artifact(path);
  };
  const getRows = () => {
    const db = openNodeDatabase({ readonly: true });
    try {
      return db.prepare(`
        SELECT conversation_id, permission_level, revision FROM conversation_command_permissions ORDER BY conversation_id
      `).all();
    } finally {
      db.close();
    }
  };

  try {
    await evidence.check('两段会话各自指定或跟随，重开后从 SQLite 回读', async () => {
      await clickConversation(cdp, 'E2E 对话 A');
      await expectTier('标准');
      await clickOption('只读');
      await expectTier('只读');
      assert.deepEqual(getRows(), [{ conversation_id: 'e2e-conversation-a', permission_level: 'read_only', revision: 1 }]);
      await clickConversation(cdp, 'E2E 对话 B');
      await expectTier('标准');
      await clickConversation(cdp, 'E2E 对话 A');
      await expectTier('只读');
      await waitFor(() => page('Boolean(document.querySelector("[data-conversation-permission-history]"))'), '回读权限变更行');
      await screenshot('conversation-read-only.png');
    });

    await evidence.check('完全访问每次确认，取消不提交', async () => {
      await clickOption('完全访问');
      await waitFor(() => page('document.querySelector(".alert-dialog-message")?.textContent?.length > 0'), '打开完全访问确认框');
      await screenshot('conversation-full-access-confirmation.png');
      await click('.alert-dialog-footer .alert-dialog-action:first-child');
      await expectTier('只读');
      assert.equal(getRows()[0].revision, 1);
      await clickOption('完全访问');
      await waitFor(() => page('document.querySelector(".alert-dialog-message")?.textContent?.length > 0'), '再次打开完全访问确认框');
      await click('.alert-dialog-footer .alert-dialog-action:last-child');
      await expectTier('完全访问');
      assert.equal(getRows()[0].permission_level, 'full_access');
    });

    await evidence.check('降低全局前显示真实影响，全部调低一次提交', async () => {
      await page(`(async () => {
        const { useUIStore } = await import('/apps/renderer/shared/stores/ui.ts');
        useUIStore().openSettingsModal('command-permission');
        return true;
      })()`);
      await click('[data-choice="read_only"] input[name="command-permission-level"]');
      await waitFor(() => page('document.querySelector(".alert-dialog-message")?.textContent?.includes("1 个对话")'), '设置显示真实受影响数量');
      await screenshot('global-reduction-preview.png');
      await click('.modal-overlay--alert .modal-close');
      await waitFor(() => page(`document.querySelector('[data-choice="standard"] input[name="command-permission-level"]')?.checked`), '关闭后恢复原全局选择');
      assert.equal(getRows()[0].permission_level, 'full_access');
      await click('[data-choice="read_only"] input[name="command-permission-level"]');
      await waitFor(() => page('document.querySelector(".alert-dialog-message")?.textContent?.includes("1 个对话")'), '重新确认影响范围');
      await click('.alert-dialog-footer .alert-dialog-action:last-child');
      await waitFor(() => page('document.querySelector(\'input[name="command-permission-level"][value="read_only"]\')?.checked'), '全局选择写入并回读');
      await waitFor(() => getRows()[0]?.revision === 3, '覆盖值写入并保留变更版本');
      assert.equal(getRows()[0].permission_level, 'read_only');
      await page(`(async () => {
        const { useUIStore } = await import('/apps/renderer/shared/stores/ui.ts');
        useUIStore().closeSettingsModal();
        return true;
      })()`);
      await clickConversation(cdp, 'E2E 对话 B');
      await expectTier('只读');
    });

    await evidence.check('空白草稿取消确认后不生成对话，明确选择可在首发前落库', async () => {
      await startNewConversationDraft(cdp);
      await expectTier('只读');
      await clickOption('完全访问');
      await waitFor(() => page('document.querySelector(".alert-dialog-message")?.textContent?.length > 0'), '草稿档位确认');
      await click('.modal-overlay--alert .modal-close');
      assert.equal(getRows().length, 1);
      await clickOption('标准');
      await expectTier('标准');
      assert.equal(getRows().find(row => row.conversation_id !== 'e2e-conversation-a')?.permission_level, 'standard');
      await screenshot('draft-permission-before-send.png');
    });
  } finally {
    console.log('[conversation-command-permissions] evidence', evidence.finish().manifest);
  }
}
