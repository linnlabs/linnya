// @vitest-environment jsdom

import { createApp, nextTick, type App } from 'vue';
import { createPinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StorageSpaceOverviewResponseSchema } from '@app/schemas';

const mocks = vi.hoisted(() => ({
  readOverview: vi.fn(),
  clearConversationWorkDirectory: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock('../infrastructure/storageSpaceGateway', () => ({
  StorageSpaceGatewayError: class StorageSpaceGatewayError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  },
  storageSpaceGateway: {
    readOverview: mocks.readOverview,
    clearConversationWorkDirectory: mocks.clearConversationWorkDirectory,
  },
}));

vi.mock('@shared/composables/confirmDialog', () => ({
  confirm: mocks.confirm,
}));

vi.mock('../../../ui/useSettingsLocalization', () => ({
  useSettingsLocalization: () => ({
    settingsMessage: (key: string) => key,
  }),
}));

import StorageSpaceSettingsTab from '../ui/StorageSpaceSettingsTab.vue';

function overview(
  state: 'available' | 'previous_files_unavailable' | 'unavailable' = 'available',
) {
  const workBytes = state === 'available' ? 9 : 0;
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
      work_files_state: state,
      byte_size: state === 'unavailable' ? null : workBytes,
      file_count: state === 'unavailable' ? null : state === 'available' ? 1 : 0,
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
    mocks.clearConversationWorkDirectory.mockReset();
    mocks.confirm.mockReset();
    container = document.createElement('div');
    document.body.append(container);
  });

  afterEach(() => {
    app?.unmount();
    container.remove();
    app = undefined;
  });

  it('首次挂载读取概览，清理前确认并在单行 pending 时禁用重复点击', async () => {
    let finishClear: (() => void) | undefined;
    const clearPending = new Promise<void>((resolve) => {
      finishClear = resolve;
    });
    mocks.readOverview
      .mockResolvedValueOnce(overview())
      .mockResolvedValueOnce(overview('previous_files_unavailable'));
    mocks.confirm.mockResolvedValue(true);
    mocks.clearConversationWorkDirectory.mockReturnValue(clearPending);

    app = createApp(StorageSpaceSettingsTab);
    app.use(createPinia());
    app.mount(container);
    await flushUi();

    expect(mocks.readOverview).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('报告整理');
    const clearButton = findButton(container, 'settings.storageSpace.actions.clear');
    clearButton.click();
    await flushUi();

    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({
      isDangerousAction: true,
      message: 'settings.storageSpace.confirm.message',
    }));
    const pendingButton = findButton(container, 'settings.storageSpace.actions.clearing');
    expect(pendingButton.disabled).toBe(true);
    pendingButton.click();
    expect(mocks.clearConversationWorkDirectory).toHaveBeenCalledTimes(1);

    if (!finishClear) throw new Error('clear completion was not initialized');
    finishClear();
    await flushUi();
    expect(mocks.readOverview).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain(
      'settings.storageSpace.status.previousFilesUnavailable',
    );
  });

  it('进入 tab 自动读取概览，失败时在错误状态提供重试入口', async () => {
    mocks.readOverview
      .mockResolvedValueOnce(overview())
      .mockRejectedValueOnce(new Error('network unavailable'));
    mocks.confirm.mockResolvedValue(false);
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

  it('单个目录无法计量时保留概览，并明确禁用该行清理', async () => {
    mocks.readOverview.mockResolvedValue(overview('unavailable'));
    app = createApp(StorageSpaceSettingsTab);
    app.use(createPinia());
    app.mount(container);
    await flushUi();

    expect(container.textContent).toContain('settings.storageSpace.status.unavailable');
    expect(container.textContent).toContain('settings.storageSpace.valueUnavailable');
    expect(findButton(container, 'settings.storageSpace.actions.clear').disabled).toBe(true);
  });
});
