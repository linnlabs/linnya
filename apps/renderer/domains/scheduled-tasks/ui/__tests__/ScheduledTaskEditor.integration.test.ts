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

function selectTrigger(host: HTMLElement, label: string): HTMLButtonElement {
  const trigger = host.querySelector<HTMLButtonElement>(`.select-trigger[aria-label="${label}"]`);
  if (!trigger) throw new Error(`select not found: ${label}`);
  return trigger;
}

/** 选择器的菜单挂在 body 上；点开后按文字选一项。 */
async function choose(host: HTMLElement, label: string, text: string): Promise<void> {
  selectTrigger(host, label).click();
  await flush();
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(item => item.textContent?.includes(text));
  if (!option) throw new Error(`option not found: ${text}`);
  option.click();
  await flush();
}

const FULL_ACCESS = 'settings.commandPermission.level.fullAccess';
const permissionText = (host: HTMLElement) => selectTrigger(host, '命令权限').textContent?.trim();

async function settlePreview(): Promise<void> {
  await vi.advanceTimersByTimeAsync(200);
  await flush();
}

async function submit(host: HTMLElement): Promise<void> {
  host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await flush();
}

describe('定时任务编辑表单', () => {
  let app: App<Element> | undefined;
  let host: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], now: new Date(2026, 10, 23, 10, 0) });
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

  it('取消完全访问确认后，权限保持原来的档位；再选会再问一次', async () => {
    mount({ task: task(), defaultProjectId: 'p1' });
    await flush();
    expect(permissionText(host)).toBe('settings.commandPermission.level.standard');

    mocks.confirmExpansion.mockResolvedValueOnce(false);
    await choose(host, '命令权限', FULL_ACCESS);
    expect(mocks.confirmExpansion).toHaveBeenCalledTimes(1);
    expect(permissionText(host)).toBe('settings.commandPermission.level.standard');

    mocks.confirmExpansion.mockResolvedValueOnce(true);
    await choose(host, '命令权限', FULL_ACCESS);
    expect(mocks.confirmExpansion).toHaveBeenCalledTimes(2);
    expect(permissionText(host)).toBe(FULL_ACCESS);
  });

  it('重复的任务：月历只标出 App Server 给的运行日期，翻月时重新问', async () => {
    mocks.previewSchedule.mockResolvedValue({ ok: true, next_runs: [NOW + 3_600_000], run_days: ['2026-11-24', '2026-11-25'] });
    mount({ task: task(), defaultProjectId: 'p1' });
    await settlePreview();
    expect(mocks.previewSchedule).toHaveBeenLastCalledWith({
      schedule: { kind: 'weekdays', time: '09:00' },
      run_days_in: { from: '2026-11-01', to: '2026-11-30' },
    });
    expect([...host.querySelectorAll('.is-marked')].map(cell => cell.getAttribute('data-date'))).toEqual(['2026-11-24', '2026-11-25']);
    expect([...host.querySelectorAll<HTMLButtonElement>('[data-date]')].every(cell => cell.disabled)).toBe(true);

    host.querySelectorAll<HTMLButtonElement>('.linnya-month-calendar .linnya-ui-icon-button')[1]?.click();
    await flush();
    expect(mocks.previewSchedule).toHaveBeenLastCalledWith({
      schedule: { kind: 'weekdays', time: '09:00' },
      run_days_in: { from: '2026-12-01', to: '2026-12-31' },
    });
  });

  it('改了时间表，月历翻到下次运行的月份', async () => {
    mocks.previewSchedule.mockResolvedValue({ ok: true, next_runs: [new Date(2026, 11, 1, 9).getTime()], run_days: ['2026-12-01'] });
    mount({ task: task(), defaultProjectId: 'p1' });
    await settlePreview();
    expect(host.querySelector('.is-marked')?.getAttribute('data-date')).toBe('2026-12-01');
    expect(mocks.previewSchedule).toHaveBeenLastCalledWith(expect.objectContaining({ run_days_in: { from: '2026-12-01', to: '2026-12-31' } }));
  });

  it('仅一次：在月历上选日子，过去的日子选不了，保存带上选的日期', async () => {
    mount({ task: task(), defaultProjectId: 'p1' });
    await choose(host, '重复方式', '仅一次');
    await settlePreview();
    expect(mocks.previewSchedule).toHaveBeenLastCalledWith({ schedule: { kind: 'once', date: '2026-11-24', time: '09:00' } });

    expect(host.querySelector<HTMLButtonElement>('[data-date="2026-11-22"]')?.disabled).toBe(true);
    host.querySelector<HTMLButtonElement>('[data-date="2026-11-27"]')?.click();
    await flush();
    expect(host.querySelector('.is-selected[data-date="2026-11-27"]')).not.toBeNull();

    mocks.update.mockResolvedValueOnce({ ok: true, task: task() } satisfies ScheduledTaskMutationResult);
    await submit(host);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ schedule: { kind: 'once', date: '2026-11-27', time: '09:00' } }));
  });

  it('时间不合规则时写明原因、不保存；检查没成功时也会说', async () => {
    mocks.previewSchedule.mockResolvedValue({ ok: false, code: 'too_frequent', message: 'too frequent' });
    mount({ task: task(), defaultProjectId: 'p1' });
    await settlePreview();
    expect(host.querySelector('[data-testid="scheduled-task-schedule-error"]')?.textContent).toContain('最短是 1 小时');
    await submit(host);
    expect(mocks.update).not.toHaveBeenCalled();

    mocks.previewSchedule.mockRejectedValueOnce(new Error('offline'));
    await submit(host);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('没能检查时间');
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('自定义写法清空时直接提示，不去问 App Server', async () => {
    mount({ task: task({ schedule: { kind: 'cron', expression: '0 9 1,15 * *' } }), defaultProjectId: 'p1' });
    await settlePreview();
    mocks.previewSchedule.mockClear();
    const input = host.querySelector<HTMLInputElement>('[data-testid="scheduled-task-cron"]')!;
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settlePreview();
    expect(host.querySelector('[data-testid="scheduled-task-schedule-error"]')?.textContent).toContain('需要 5 段');
    expect(mocks.previewSchedule).not.toHaveBeenCalled();
  });

  it('Agent 用 cron 建的工作日 8:30 按预设打开，保存成预设', async () => {
    mocks.update.mockResolvedValueOnce({ ok: true, task: task() } satisfies ScheduledTaskMutationResult);
    mount({ task: task({ schedule: { kind: 'cron', expression: '30 8 * * 1-5' } }), defaultProjectId: 'p1' });
    await settlePreview();
    expect(selectTrigger(host, '重复方式').textContent?.trim()).toBe('工作日');
    expect(host.querySelector('[data-testid="scheduled-task-cron"]')).toBeNull();
    await submit(host);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ schedule: { kind: 'weekdays', time: '08:30' } }));
  });

  it('名称或任务没写时提示，不保存', async () => {
    const { emitted } = mount({ task: null, defaultProjectId: 'p1' });
    await flush();
    await submit(host);
    expect(host.textContent).toContain('写一个名称');
    expect(host.textContent).toContain('写清楚每次要做什么');
    expect(mocks.create).not.toHaveBeenCalled();
    expect(emitted.saved).toHaveLength(0);
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
