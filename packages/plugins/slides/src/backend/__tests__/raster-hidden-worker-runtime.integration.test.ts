import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const electronMockState = vi.hoisted(() => ({
  malformedResponse: false,
  loadFailure: false,
  readyProtocolVersion: undefined as number | undefined,
  closedWindowCount: 0,
  workerPid: 12_345,
}));

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  const { SLIDES_RASTER_WORKER_PROTOCOL_VERSION } = await import(
    '../../shared/slideRasterization'
  );
  const ipcMain = new EventEmitter();

  class FakeWebContents extends EventEmitter {
    private destroyed = false;

    send(channel: string, payload: unknown): void {
      const requestId = readRequestId(payload);
      const bytes = electronMockState.malformedResponse
        ? [137, 80, 78, 71]
        : new Uint8Array([137, 80, 78, 71]);
      queueMicrotask(() => {
        ipcMain.emit(
          channel.replace(':request', ':response'),
          { sender: this },
          {
            requestId,
            protocolVersion: SLIDES_RASTER_WORKER_PROTOCOL_VERSION,
            result: {
              status: 'success',
              requestId,
              format: 'png',
              widthPx: 1280,
              heightPx: 720,
              bytes,
            },
          },
        );
      });
    }

    isDestroyed(): boolean {
      return this.destroyed;
    }

    getOSProcessId(): number {
      return electronMockState.workerPid;
    }

    destroy(): void {
      this.destroyed = true;
    }
  }

  class FakeBrowserWindow extends EventEmitter {
    readonly webContents = new FakeWebContents();
    private destroyed = false;

    async loadFile(): Promise<void> {
      if (electronMockState.loadFailure) {
        throw new Error('worker HTML load failed');
      }
      queueMicrotask(() => {
        ipcMain.emit('slides:raster-worker:ready', { sender: this.webContents }, {
          workerId: 'slides-raster',
          protocolVersion: electronMockState.readyProtocolVersion
            ?? SLIDES_RASTER_WORKER_PROTOCOL_VERSION,
        });
      });
    }

    close(): void {
      if (this.destroyed) {
        return;
      }
      this.destroyed = true;
      this.webContents.destroy();
      electronMockState.closedWindowCount += 1;
      this.emit('closed');
    }

    isDestroyed(): boolean {
      return this.destroyed;
    }
  }

  function readRequestId(payload: unknown): string {
    if (payload == null || typeof payload !== 'object') {
      return 'invalid-request';
    }
    const requestId = Reflect.get(payload, 'requestId');
    return typeof requestId === 'string' ? requestId : 'invalid-request';
  }

  return {
    BrowserWindow: FakeBrowserWindow,
    ipcMain,
  };
});

import {
  SLIDES_RASTER_WORKER_PROTOCOL_VERSION,
  type SlideRasterRequest,
} from '@plugin/slides/shared/slideRasterization';
import { createSlidesRasterWorkerDefinition } from '../features/slideRasterWorker/infrastructure/createSlidesRasterWorkerDefinition';
import {
  clearHiddenWorkersForTests,
  hasHiddenWorker,
} from 'src/electron-main/hidden-worker/hiddenWorkerRuntime';
import { createElectronDesktopHiddenWorkerHostPort } from 'src/electron-main/desktop-capabilities/backend-hidden-worker-runtime';
import {
  clearBackendHiddenWorkerRuntimePortForTesting,
  createBackendHiddenWorkerRuntime,
  getBackendHiddenWorkerRuntimePort,
  installBackendHiddenWorkerRuntimePort,
} from 'src/app-hosts/linnya/desktop-capabilities';
import { pluginDiagnostics } from 'src/app-hosts/linnya/plugin-registry/diagnostics';
import {
  clearSyncedBackendPluginHiddenWorkersForTests,
  syncBackendPluginHiddenWorkers,
} from 'src/app-hosts/linnya/plugin-registry/hiddenWorkerPluginRuntime';

function createRequest(requestId: string): SlideRasterRequest {
  return {
    requestId,
    slide: {
      slideId: 'slide-1',
      index: 0,
      layoutKey: 'blank',
      background: { paint: { type: 'solid', color: '#FFFFFF' } },
      elements: [],
    },
    slideSize: { width: 10, height: 5.625, unit: 'in' },
    profile: {
      id: 'agent-inspection-v1',
      viewportWidthPx: 1280,
      viewportHeightPx: 720,
      pixelRatio: 1,
      format: 'png',
    },
  };
}

function createRegistration() {
  return [{
    pluginId: 'slides',
    worker: createSlidesRasterWorkerDefinition({
      runtime: {
        mode: 'artifact-runtime',
        packageRoot: '/plugin',
        rootSource: 'explicit',
      },
      recordDiagnostic: () => {},
    }),
  }];
}

describe('slides raster hidden worker runtime', () => {
  beforeEach(() => {
    installBackendHiddenWorkerRuntimePort(createBackendHiddenWorkerRuntime(
      createElectronDesktopHiddenWorkerHostPort(),
    ));
  });

  afterEach(async () => {
    electronMockState.malformedResponse = false;
    electronMockState.loadFailure = false;
    electronMockState.readyProtocolVersion = SLIDES_RASTER_WORKER_PROTOCOL_VERSION;
    await clearSyncedBackendPluginHiddenWorkersForTests();
    await clearHiddenWorkersForTests();
    clearBackendHiddenWorkerRuntimePortForTesting();
    electronMockState.closedWindowCount = 0;
    pluginDiagnostics.clear();
  });

  it('通过插件 registry 注册、调用，并在禁用插件时释放 worker', async () => {
    await syncBackendPluginHiddenWorkers(createRegistration());

    expect(hasHiddenWorker('slides-raster')).toBe(true);
    await expect(getBackendHiddenWorkerRuntimePort().invokeHiddenWorker(
      'slides-raster',
      createRequest('request-1'),
    ))
      .resolves.toEqual({
        status: 'success',
        requestId: 'request-1',
        format: 'png',
        widthPx: 1280,
        heightPx: 720,
        bytes: new Uint8Array([137, 80, 78, 71]),
      });

    await syncBackendPluginHiddenWorkers([]);

    expect(hasHiddenWorker('slides-raster')).toBe(false);
    expect(electronMockState.closedWindowCount).toBe(1);
  });

  it('Desktop Host adapter 与诊断模块共享 worker 进程身份', async () => {
    await syncBackendPluginHiddenWorkers(createRegistration());
    await getBackendHiddenWorkerRuntimePort().invokeHiddenWorker(
      'slides-raster',
      createRequest('request-process-identity'),
    );

    // 重置模块 registry 模拟 Main 与诊断 bundle 各自内联一份 Desktop 实现；
    // 两者仍应通过同一宿主进程 globalThis 看到真实 PID。
    vi.resetModules();
    const shellBundleRuntime = await import(
      'src/electron-main/hidden-worker/hiddenWorkerRuntime'
    );

    expect(shellBundleRuntime.listHiddenWorkerProcessIdentities()).toEqual([{
      workerId: 'slides-raster',
      pid: electronMockState.workerPid,
    }]);
  });

  it('响应不符合 Slides 协议时拒绝请求并销毁 worker', async () => {
    electronMockState.malformedResponse = true;
    await syncBackendPluginHiddenWorkers(createRegistration());

    await expect(getBackendHiddenWorkerRuntimePort().invokeHiddenWorker(
      'slides-raster',
      createRequest('request-malformed'),
    ))
      .rejects.toThrow('Invalid slide raster result bytes');
    expect(electronMockState.closedWindowCount).toBe(1);
  });

  it('worker HTML 加载失败时结束 ready 等待并释放窗口', async () => {
    electronMockState.loadFailure = true;
    await syncBackendPluginHiddenWorkers(createRegistration());

    await expect(getBackendHiddenWorkerRuntimePort().invokeHiddenWorker(
      'slides-raster',
      createRequest('request-load-failure'),
    ))
      .rejects.toThrow('worker HTML load failed');
    expect(electronMockState.closedWindowCount).toBe(1);
  });

  it('旧 worker 协议在 ready 阶段失败并释放窗口', async () => {
    electronMockState.readyProtocolVersion = 1;
    await syncBackendPluginHiddenWorkers(createRegistration());

    await expect(getBackendHiddenWorkerRuntimePort().invokeHiddenWorker(
      'slides-raster',
      createRequest('request-old-protocol'),
    ))
      .rejects.toThrow('Unsupported slides raster worker protocol version');
    expect(electronMockState.closedWindowCount).toBe(1);
  });
});
