// @vitest-environment jsdom

import { createApp, nextTick, type App } from 'vue';
import { createPinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StorageSpaceOverviewResponseSchema } from '@app/schemas';

const mocks = vi.hoisted(() => ({
  readOverview: vi.fn(),
}));

vi.mock('../infrastructure/storageSpaceGateway', () => ({
  StorageSpaceGatewayError: class StorageSpaceGatewayError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  },
  storageSpaceGateway: {
    readOverview: mocks.readOverview,
  },
}));

vi.mock('../../../ui/useSettingsLocalization', () => ({
  useSettingsLocalization: () => ({
    settingsMessage: (key: string) => key,
  }),
}));

import StorageSpaceSettingsTab from '../ui/StorageSpaceSettingsTab.vue';

function overview() {
  const workBytes = 9;
  return StorageSpaceOverviewResponseSchema.parse({
    measured_at_ms: 1_786_104_003_000,
    total_byte_size: workBytes,
    categories: [
      { kind: 'conversation_work_files', byte_size: workBytes },
      { kind: 'workspace', byte_size: 0 },
      { kind: 'attachments', byte_size: 0 },
      { kind: 'temporary_outputs', byte_size: 0 },
      { kind: 'diagnostic_logs', byte_size: 0 },
      { kind: 'application_data', byte_size: 0 },
    ],
    conversations: [{
      conversation_id: 'conversation-a',
      title: '报告整理',
      project_id: null,
      work_files_state: 'available',
      byte_size: workBytes,
      file_count: 1,
    }],
  });
}

async function flushUi(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await nextTick();
}

function findButton(container: HTMLElement, messageKey: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find(candidate => (
    candidate.textContent?.trim() === messageKey
  ));
  if (!button) throw new Error(`button not found: ${messageKey}`);
  return button;
}

describe('StorageSpaceSettingsTab', () => {
  let app: App<Element> | undefined;
  let container: HTMLDivElement;

  beforeEach(() => {
    mocks.readOverview.mockReset();
    container = document.createElement('div');
    document.body.append(container);
  });

  afterEach(() => {
    app?.unmount();
    container.remove();
    app = undefined;
  });

  it('只显示总量和分类，不再列出每个对话（对话的占用在项目概览）', async () => {
    mocks.readOverview.mockResolvedValueOnce(overview());
    app = createApp(StorageSpaceSettingsTab);
    app.use(createPinia());
    app.mount(container);
    await flushUi();

    expect(mocks.readOverview).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('settings.storageSpace.total');
    expect(container.textContent).toContain('settings.storageSpace.category.conversationWorkFiles');
    expect(container.textContent).not.toContain('报告整理');
  });

  it('进入 tab 自动读取概览，失败时在错误状态提供重试入口', async () => {
    mocks.readOverview
      .mockResolvedValueOnce(overview())
      .mockRejectedValueOnce(new Error('network unavailable'));
    app = createApp(StorageSpaceSettingsTab);
    app.use(createPinia());
    app.mount(container);
    await flushUi();

    expect(Array.from(container.querySelectorAll('button')).some(button => (
      button.textContent?.trim() === 'settings.storageSpace.actions.refresh'
    ))).toBe(false);

    // 通过重新挂载模拟再次进入存储空间 tab，读取失败后应显示恢复入口。
    app.unmount();
    app = undefined;
    app = createApp(StorageSpaceSettingsTab);
    app.use(createPinia());
    app.mount(container);
    await flushUi();
    expect(mocks.readOverview).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('settings.storageSpace.unavailable');
    expect(findButton(container, 'settings.storageSpace.actions.refresh')).toBeTruthy();
  });
});
