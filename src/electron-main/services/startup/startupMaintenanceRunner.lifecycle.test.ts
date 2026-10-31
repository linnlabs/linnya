import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./log-maintenance', () => ({ runStartupLogMaintenanceOnce: vi.fn() }));

import { runStartupLogMaintenanceOnce } from './log-maintenance';
import { scheduleStartupMaintenanceOnce, type StartupMaintenanceDeps } from './startupMaintenanceRunner';

// 本组只验证维护生命周期；记录任何停止后的存储访问，不碰测试机数据。
const unexpectedStorageAccess = vi.fn((): never => { throw new Error('停止后不应访问存储'); });
const deps: StartupMaintenanceDeps = {
  get databaseService() { return unexpectedStorageAccess(); },
  get metadataRepository() { return unexpectedStorageAccess(); },
  get qdrantRepository() { return unexpectedStorageAccess(); },
  get sotRepository() { return unexpectedStorageAccess(); },
  get originalDocumentRepository() { return unexpectedStorageAccess(); },
};

afterEach(() => {
  vi.clearAllMocks();
  vi.mocked(runStartupLogMaintenanceOnce).mockReset();
});

describe('启动维护生命周期', () => {
  it('启动后立即退出取消延迟，维护不再触碰存储', async () => {
    const lifecycle = scheduleStartupMaintenanceOnce(deps);
    await lifecycle.stop();
    expect(runStartupLogMaintenanceOnce).not.toHaveBeenCalled();
    expect(unexpectedStorageAccess).not.toHaveBeenCalled();
  });

  it('退出等待已开始的维护完成，但不启动下一项', async () => {
    let markStarted: (() => void) | undefined;
    let finishMaintenance: (() => void) | undefined;
    const started = new Promise<void>(resolve => { markStarted = resolve; });
    const finish = new Promise<void>(resolve => { finishMaintenance = resolve; });
    vi.mocked(runStartupLogMaintenanceOnce).mockImplementation(async () => {
      markStarted?.();
      await finish;
      return { scannedFiles: 0, deletedFiles: 0, skippedFiles: 0, failedFiles: 0 };
    });
    const lifecycle = scheduleStartupMaintenanceOnce(deps, { initialDelayMs: 0 });
    await started;
    let stopped = false;
    const stopping = lifecycle.stop().then(() => { stopped = true; });
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(stopped).toBe(false);
    finishMaintenance?.();
    await stopping;
    expect(stopped).toBe(true);
    expect(runStartupLogMaintenanceOnce).toHaveBeenCalledOnce();
    expect(unexpectedStorageAccess).not.toHaveBeenCalled();
  });
});
