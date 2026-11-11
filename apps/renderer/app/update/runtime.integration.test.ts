import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { AppUpdateState } from '../../../../src/shared/update/definitions/updateMessage';
import type { AppUpdateApi } from './definitions/updateRuntime';
import { useUpdateStore } from './store/updateStore';
import { useUpdateActions } from './runtime';

const initial: AppUpdateState = {
  enabled: true,
  status: 'available',
  currentVersion: '1',
  version: '2',
  releaseNotes: null,
  progress: null,
  failure: null,
  installedVersion: null,
};
function apiFixture() {
  let onState: ((state: AppUpdateState) => void) | undefined;
  const unsubscribe = vi.fn();
  const api = {
    getState: vi.fn(async () => initial),
    onState: vi.fn((listener: (state: AppUpdateState) => void) => {
      onState = listener;
      return unsubscribe;
    }),
    check: vi.fn(),
    download: vi.fn(),
    cancelDownload: vi.fn(),
    install: vi.fn(),
    acknowledgeInstalled: vi.fn(),
  } satisfies AppUpdateApi;
  return { api, unsubscribe, emit: (state: AppUpdateState) => onState?.(state) };
}
describe('应用更新快照与确认流程', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });
  it('重复连接不重复订阅，命令转发和断开后重连仍读 Main 状态', async () => {
    const { api, emit, unsubscribe } = apiFixture();
    const actions = useUpdateActions(),
      state = useUpdateStore();
    await actions.connect(api);
    await useUpdateActions().connect(api);
    expect(api.getState).toHaveBeenCalledTimes(1);
    expect(state.status).toBe('available');
    emit({ ...initial, status: 'ready' });
    expect(state.status).toBe('ready');
    await actions.download();
    await actions.cancelDownload();
    await actions.acknowledgeInstalled();
    expect(api.download).toHaveBeenCalledTimes(1);
    expect(api.cancelDownload).toHaveBeenCalledTimes(1);
    expect(api.acknowledgeInstalled).toHaveBeenCalledTimes(1);
    actions.disconnect();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    await actions.connect(api);
    expect(api.getState).toHaveBeenCalledTimes(2);
  });
  it('确认时只回传上次展示的任务，新任务出现需要再次确认', async () => {
    const { api } = apiFixture();
    const actions = useUpdateActions(),
      state = useUpdateStore();
    await actions.connect(api);
    const first = { key: 'run-1', kind: 'conversation' as const, title: '任务一' };
    const second = { key: 'run-2', kind: 'conversation' as const, title: '任务二' };
    api.install.mockResolvedValueOnce({ outcome: 'confirmation_required', activities: [first] });
    await actions.requestRestart();
    expect(state.pendingActivities).toEqual([first]);
    expect(state.activitiesChanged).toBe(false);
    api.install.mockResolvedValueOnce({
      outcome: 'confirmation_required',
      activities: [first, second],
    });
    await actions.confirmRestart();
    expect(api.install).toHaveBeenLastCalledWith({ confirmedActivityKeys: ['run-1'] });
    expect(state.activitiesChanged).toBe(true);
    api.install.mockResolvedValueOnce({ outcome: 'kept_open' });
    await actions.confirmRestart();
    expect(api.install).toHaveBeenLastCalledWith({ confirmedActivityKeys: ['run-1', 'run-2'] });
    expect(state.pendingActivities).toBeNull();
    expect(state.requestingRestart).toBe(false);
  });
  it('正在确认时不重复安装，失败后释放请求状态，取消确认只更新本地状态', async () => {
    const { api } = apiFixture();
    const actions = useUpdateActions(),
      state = useUpdateStore();
    await actions.connect(api);
    let reject: (reason: Error) => void = () => {};
    api.install.mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        })
    );
    const pending = actions.requestRestart();
    await actions.requestRestart();
    expect(api.install).toHaveBeenCalledTimes(1);
    reject(new Error('not ready'));
    await expect(pending).rejects.toThrow('not ready');
    expect(state.requestingRestart).toBe(false);
    state.setConfirmation([{ key: 'run-1', kind: 'conversation', title: null }], true);
    state.declineRestart();
    expect(state.pendingActivities).toBeNull();
    expect(state.activitiesChanged).toBe(false);
  });
});
