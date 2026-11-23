// @vitest-environment jsdom

import { createPinia, setActivePinia } from 'pinia';
import { createApp, h, nextTick, reactive, ref, type App } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScheduledTask, ScheduledTaskMutationResult } from '@app/schemas/scheduled-tasks';

const mocks = vi.hoisted(() => ({
  previewSchedule: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  confirmExpansion: vi.fn(),
  catalogModels: [] as { id: string; display_name: string }[],
}));

vi.mock('../../adapters/scheduledTasksClient', () => ({
  scheduledTasksClient: {
    previewSchedule: mocks.previewSchedule,
    update: mocks.update,
    create: mocks.create,
  },
}));

vi.mock('@/app/workflows/command-permissions', () => ({
  requestConversationCommandPermission: vi.fn().mockResolvedValue({ kind: 'view', view: { global_level: 'standard' } }),
}));

vi.mock('@/domains/model-configuration', () => ({
  buildConversationModelSelectOptions: () => [],
  useModelPickerReadModel: () => ({ snapshot: ref(null) }),
  useModelCatalogReadModel: () => ({ models: ref(mocks.catalogModels) }),
}));

vi.mock('@/domains/settings/public', () => ({
  confirmPermissionLevelExpansion: mocks.confirmExpansion,
  useSettingsLocalization: () => ({ settingsMessage: (key: string) => key }),
}));

vi.mock('@/domains/workspace/store', () => ({
  useWorkspaceProjectsStore: () => ({ projects: [{ id: 'p1', name: 'Project' }] }),
}));

import ScheduledTaskEditor from '../ScheduledTaskEditor.vue';

const NOW = Date.UTC(2026, 10, 23, 2, 0);

function task(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: 't1', project_id: 'p1', name: '每日新闻', prompt: '搜集新闻', agent: 'default', model_config_id: null,
    model_unavailable: false, schedule: { kind: 'weekdays', time: '09:00' }, missed_policy: 'run_latest',
    permission_level: 'standard', state: 'scheduled', next_run_at: NOW + 3_600_000, last_run: null,
    consecutive_failures: 0, unread_count: 0, run_count: 0, storage_bytes: null,
    source: { kind: 'user' }, created_at: NOW, updated_at: NOW, revision: 3,
    ...overrides,
  } as ScheduledTask;
}

async function flush(): Promise<void> {
  for (let index = 0; index < 4; index += 1) {
    await Promise.resolve();
    await nextTick();
  }
}

function radios(host: HTMLElement): HTMLInputElement[] {
  return [...host.querySelectorAll<HTMLInputElement>('.scheduled-task-editor__tier input[type=radio]')];
}

function checkedLevel(host: HTMLElement): string | undefined {
  return radios(host).find(input => input.checked)?.value;
}

async function submit(host: HTMLElement): Promise<void> {
  host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await flush();
}

describe('定时任务编辑表单', () => {
  let app: App<Element> | undefined;
  let host: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    setActivePinia(createPinia());
    mocks.previewSchedule.mockReset().mockResolvedValue({ ok: true, next_runs: [NOW + 3_600_000] });
    mocks.update.mockReset();
    mocks.create.mockReset();
    mocks.confirmExpansion.mockReset();
    mocks.catalogModels.splice(0);
    host = document.createElement('div');
    document.body.append(host);
  });

  afterEach(() => {
    app?.unmount();
    host.remove();
    app = undefined;
    vi.useRealTimers();
  });

  function mount(props: Record<string, unknown>) {
    const emitted = { saved: [] as unknown[][], conflict: 0 };
    const state = reactive({ ...props });
    app = createApp({
      render: () => h(ScheduledTaskEditor, {
        ...state,
        onSaved: (...args: unknown[]) => emitted.saved.push(args),
        onConflict: () => { emitted.conflict += 1; },
      }),
    });
    app.use(createPinia());
    app.mount(host);
    return { emitted, state };
  }

  it('取消完全访问确认后，单选回到原来的档位；再点会再问一次', async () => {
    mount({ task: task(), defaultProjectId: 'p1' });
    await flush();
    expect(checkedLevel(host)).toBe('standard');

    mocks.confirmExpansion.mockResolvedValueOnce(false);
    radios(host).find(input => input.value === 'full_access')!.click();
    await flush();
    expect(mocks.confirmExpansion).toHaveBeenCalledTimes(1);
    expect(checkedLevel(host)).toBe('standard');

    mocks.confirmExpansion.mockResolvedValueOnce(true);
    radios(host).find(input => input.value === 'full_access')!.click();
    await flush();
    expect(mocks.confirmExpansion).toHaveBeenCalledTimes(2);
    expect(checkedLevel(host)).toBe('full_access');
  });

  it('保存用打开表单时的版本；任务在别处被改后报冲突，不静默覆盖', async () => {
    const { emitted, state } = mount({ task: task({ revision: 3 }), defaultProjectId: 'p1' });
    await flush();
    // 设置页降档、Agent 改任务等：store 推来新版本，props 跟着变。
    state.task = task({ revision: 4, permission_level: 'read_only' });
    await flush();
    mocks.update.mockResolvedValueOnce({ ok: false, code: 'revision_conflict', message: 'changed' } satisfies ScheduledTaskMutationResult);

    await submit(host);

    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ task_id: 't1', expected_revision: 3 }));
    expect(emitted.conflict).toBe(1);
    expect(emitted.saved).toHaveLength(0);
  });

  it('冲突后重开的表单带着那句提示', async () => {
    mount({ task: task(), defaultProjectId: 'p1', initialError: '任务刚在别处被改过，已经刷新，请再改一次。' });
    await flush();
    expect(host.querySelector('.scheduled-task-editor__error')?.textContent).toContain('任务刚在别处被改过');
  });

  it('模型在模型管理里被隐藏时显示它的名字，真删了才说已删除', async () => {
    mocks.catalogModels.push({ id: 'hidden-model', display_name: 'Hidden Model' });
    mount({ task: task({ model_config_id: 'hidden-model' }), defaultProjectId: 'p1' });
    await flush();
    expect(host.textContent).toContain('Hidden Model');

    app?.unmount();
    mocks.catalogModels.splice(0);
    mount({ task: task({ model_config_id: 'gone-model' }), defaultProjectId: 'p1' });
    await flush();
    expect(host.textContent).not.toContain('gone-model');
  });
});
