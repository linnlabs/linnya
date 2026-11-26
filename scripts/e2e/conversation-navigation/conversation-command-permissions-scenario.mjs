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
  // 底栏只显示档位图标，档位名在按钮的无障碍标签“命令权限：{档位}（跟随全局设置 / 只对这个对话）”里。
  const readTier = () => page(`document.querySelector(${JSON.stringify(tierButton)})?.getAttribute('aria-label')?.match(/^命令权限：(.+?)（/)?.[1] ?? null`);
  const expectTier = label => waitFor(async () => await readTier() === label, `输入框显示 ${label}`);
  const click = async selector => {
    await waitFor(() => page(`(() => {
      const target = document.querySelector(${JSON.stringify(selector)});
      if (!(target instanceof HTMLElement) || target.matches(':disabled')) return false;
      target.click();
      return true;
    })()`), selector);
  };
  /** 权限按钮中心点由谁接住鼠标：默认要求按钮自己接住，传入 `hitOwner` 时要求那一层接住。 */
  const tierButtonPoint = (label, hitOwner = null) => waitFor(() => page(`(() => {
      const button = document.querySelector(${JSON.stringify(tierButton)});
      if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
      const rect = button.getBoundingClientRect();
      const x = rect.x + rect.width / 2;
      const y = rect.y + rect.height / 2;
      const owner = ${JSON.stringify(hitOwner)} === null ? button : document.querySelector(${JSON.stringify(hitOwner)});
      return Boolean(owner?.contains(document.elementFromPoint(x, y))) && { x, y };
    })()`), label);
  const pressAt = async point => {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
  };
  const clickTierButton = async () => pressAt(await tierButtonPoint('底栏权限入口可由鼠标访问'));
  const readSettingsModal = () => page(`(async () => {
    const { useUIStore } = await import('/apps/renderer/shared/stores/ui.ts');
    const ui = useUIStore();
    return { visible: ui.settingsModalVisible, tab: ui.settingsInitialTabId };
  })()`);
  const closeSettingsModal = () => page(`(async () => {
    const { useUIStore } = await import('/apps/renderer/shared/stores/ui.ts');
    useUIStore().closeSettingsModal();
    return true;
  })()`);
  /**
   * 走用户“添加自定义 API”的同一接口登记一个模型，让输入框进入已配置模型的真实状态。
   * 本场景只切命令档位、不发消息，登记也不连接端点，所以地址指向本机一个不监听的端口即可。
   */
  const registerFixtureModel = () => page(`(async () => {
    const session = await window.electronAPI.invoke('api:get-port');
    const response = await fetch('http://127.0.0.1:' + session.port + '/api/v1/custom-api-onboarding/models', {
      method: 'POST',
      headers: { 'X-API-Token': session.token, 'content-type': 'application/json' },
      body: ${JSON.stringify(JSON.stringify({
        provider_name: 'Command permission fixture',
        api_format: 'openai_compatible',
        base_url: 'http://127.0.0.1:9/v1',
        api_key: 'command-permission-fixture',
        endpoint_model_id: 'command-permission-fixture',
        display_name: 'Command permission fixture',
        context_window_tokens: 64000,
        max_output_tokens: 4096,
        supports_image_input: false,
      }))},
    });
    const body = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(body));
    return body.model_id;
  })()`);
  const clickOption = async text => {
    await clickTierButton();
    await waitFor(() => page(`(() => {
      const option = [...document.querySelectorAll('[role="option"]')]
        .find(el => el.querySelector('.option-label')?.textContent?.trim() === ${JSON.stringify(text)} && el.getBoundingClientRect().width > 0);
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
    // 合成数据没有用户模型：先确认玻璃遮罩盖住整个输入框（底栏也在下面），再登记模型进入正常状态。
    await evidence.check('未配置模型时遮罩盖住整个输入框，点底栏也进入模型设置', async () => {
      await clickConversation(cdp, 'E2E 对话 A');
      const covered = await tierButtonPoint('底栏权限入口被模型设置遮罩盖住', '.ai-assistant-input__model-setup-overlay');
      await screenshot('model-setup-overlay.png');
      await pressAt(covered);
      await waitFor(async () => {
        const modal = await readSettingsModal();
        return modal.visible && modal.tab === 'model';
      }, '点底栏位置打开模型设置');
      await closeSettingsModal();
      await registerFixtureModel();
      await waitFor(() => page(`!document.querySelector('.ai-assistant-input__model-setup-overlay')`), '登记模型后遮罩消失');
    });

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
      await waitFor(() => page('document.querySelector("[data-command-permission-change]")?.textContent?.includes("改为“只读”")'), '时间线回读权限变更记录');
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
      await closeSettingsModal();
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
