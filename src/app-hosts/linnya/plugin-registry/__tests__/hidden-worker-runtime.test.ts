import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  BrowserWindow: class FakeBrowserWindow {},
  ipcMain: new EventEmitter(),
}));
import {
  clearHiddenWorkersForTests,
  hasHiddenWorker,
} from '../../../../electron-main/hidden-worker/hiddenWorkerRuntime';
import { createElectronDesktopHiddenWorkerHostPort } from '../../../../electron-main/desktop-capabilities/backend-hidden-worker-runtime';
import {
  clearBackendHiddenWorkerRuntimePortForTesting,
  createBackendHiddenWorkerRuntime,
  installBackendHiddenWorkerRuntimePort,
} from '../../desktop-capabilities';
import { pluginDiagnostics } from '../diagnostics';
import type { BackendPluginHiddenWorkerRegistration } from '../registry';
import {
  clearSyncedBackendPluginHiddenWorkersForTests,
  syncBackendPluginHiddenWorkers,
} from '../hiddenWorkerPluginRuntime';

function makeWorker(id: string): BackendPluginHiddenWorkerRegistration['worker'] {
  return {
    id,
    requestChannel: `${id}:request`,
    responseChannel: `${id}:response`,
    readyChannel: `${id}:ready`,
    workerHtmlPath: `/tmp/${id}.html`,
    preloadPath: `/tmp/${id}-preload.js`,
    createRequestPayload: () => ({
      requestId: `${id}-request`,
      payload: { requestId: `${id}-request` },
    }),
    parseResponsePayload: () => ({
      requestId: `${id}-request`,
      response: null,
    }),
    parseReadyPayload: () => undefined,
  };
}

describe('backend plugin hidden worker runtime', () => {
  beforeEach(() => {
    installBackendHiddenWorkerRuntimePort(createBackendHiddenWorkerRuntime(
      createElectronDesktopHiddenWorkerHostPort(),
    ));
  });

  afterEach(async () => {
    await clearSyncedBackendPluginHiddenWorkersForTests();
    await clearHiddenWorkersForTests();
    clearBackendHiddenWorkerRuntimePortForTesting();
    pluginDiagnostics.clear();
  });

  it('按 enabled contribution 注册和注销 hidden worker', async () => {
    const registrations: BackendPluginHiddenWorkerRegistration[] = [{
      pluginId: 'demo',
      worker: makeWorker('demo-worker'),
    }];

    await syncBackendPluginHiddenWorkers(registrations);
    await syncBackendPluginHiddenWorkers(registrations);

    expect(hasHiddenWorker('demo-worker')).toBe(true);

    await syncBackendPluginHiddenWorkers([]);

    expect(hasHiddenWorker('demo-worker')).toBe(false);
  });

  it('拒绝两个插件声明同一个 hidden worker id', async () => {
    await expect(syncBackendPluginHiddenWorkers([
      { pluginId: 'first', worker: makeWorker('duplicate') },
      { pluginId: 'second', worker: makeWorker('duplicate') },
    ])).rejects.toThrow('hidden worker id 冲突: duplicate (first, second)');
    expect(hasHiddenWorker('duplicate')).toBe(false);
  });
});
