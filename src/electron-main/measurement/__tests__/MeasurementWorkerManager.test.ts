import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MEASUREMENT_BATCH_REQUEST_CHANNEL,
  MEASUREMENT_BATCH_RESPONSE_CHANNEL,
  MEASUREMENT_WORKER_READY_CHANNEL,
  createMeasurementBatchResponse,
  createMeasurementWorkerReadyPayload,
  parseMeasurementBatchRequest,
} from '../../../features/text-measurement/infrastructure/browser-pretext/protocol.js';
import { MeasurementWorkerManager } from '../MeasurementWorkerManager.js';

const sampleInput = {
  paragraphs: [
    {
      text: 'Growth engine',
      indentInches: 0,
      spacingBeforePt: 0,
      spacingAfterPt: 0,
    },
  ],
  style: {
    fontFamily: 'Arial',
    fontSizePt: 12,
    lineHeightMultiplier: 1.2,
    bold: false,
    italic: false,
    letterSpacingPt: 0,
  },
  box: {
    widthInches: 2.5,
    heightInches: 1,
    wrap: 'word' as const,
    padding: {
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    },
    usableWidthInches: 2.5,
    usableHeightInches: 1,
  },
  sourceKind: 'generated' as const,
};

class FakeIpcMain extends EventEmitter {
}

class FakeWebContents extends EventEmitter {
  private destroyed = false;
  private strictDestroyed = false;

  constructor(
    private readonly ipcMain: FakeIpcMain,
    private readonly createResults: (requestId: string) => ReturnType<typeof createMeasurementBatchResponse>['results'],
  ) {
    super();
  }

  send(channel: string, payload: unknown): void {
    if (channel !== MEASUREMENT_BATCH_REQUEST_CHANNEL) {
      return;
    }

    const request = parseMeasurementBatchRequest(payload);
    queueMicrotask(() => {
      const response = createMeasurementBatchResponse(request.requestId, this.createResults(request.requestId));
      this.ipcMain.emit(MEASUREMENT_BATCH_RESPONSE_CHANNEL, { sender: this }, response);
    });
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  getOSProcessId(): number {
    return 10_001;
  }

  markDestroyed(): void {
    this.destroyed = true;
  }

  enableStrictDestroyed(): void {
    this.strictDestroyed = true;
  }

  off(eventName: string | symbol, listener: (...args: unknown[]) => void): this {
    if (this.strictDestroyed && this.destroyed) {
      throw new TypeError('Object has been destroyed');
    }
    return super.off(eventName, listener);
  }
}

interface FakeBrowserWindowOptions {
  /**
   * H8 回归用：模拟真 Electron 行为——close 后 `.webContents` getter
   * 与 `.off()` 直接抛 `TypeError: Object has been destroyed`。
   * 默认 false，保持已有测试兼容。
   */
  strictDestroyed?: boolean;
}

class FakeBrowserWindow extends EventEmitter {
  private readonly _webContents: FakeWebContents;
  loadedFilePath: string | null = null;
  closed = false;
  private readonly strictDestroyed: boolean;

  constructor(
    private readonly ipcMain: FakeIpcMain,
    createResults: (requestId: string) => ReturnType<typeof createMeasurementBatchResponse>['results'],
    options: FakeBrowserWindowOptions = {},
  ) {
    super();
    this._webContents = new FakeWebContents(ipcMain, createResults);
    this.strictDestroyed = options.strictDestroyed ?? false;
    if (this.strictDestroyed) {
      this._webContents.enableStrictDestroyed();
    }
  }

  get webContents(): FakeWebContents {
    if (this.strictDestroyed && this.closed) {
      throw new TypeError('Object has been destroyed');
    }
    return this._webContents;
  }

  /** 测试用：永远拿到底层 webContents，绕过 destroyed 检查（用来断言其状态）。 */
  rawWebContents(): FakeWebContents {
    return this._webContents;
  }

  async loadFile(filePath: string): Promise<void> {
    this.loadedFilePath = filePath;
    queueMicrotask(() => {
      this.ipcMain.emit(
        MEASUREMENT_WORKER_READY_CHANNEL,
        { sender: this._webContents },
        createMeasurementWorkerReadyPayload(),
      );
    });
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this._webContents.markDestroyed();
    this.emit('closed');
  }

  off(eventName: string | symbol, listener: (...args: unknown[]) => void): this {
    if (this.strictDestroyed && this.closed) {
      throw new TypeError('Object has been destroyed');
    }
    return super.off(eventName, listener);
  }

  isDestroyed(): boolean {
    return this.closed;
  }

  crash(): void {
    this._webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 });
    this.close();
  }
}

describe('MeasurementWorkerManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
  });

  it('spawns a worker and completes a batch round-trip', async () => {
    const ipcMain = new FakeIpcMain();
    const createdWindows: FakeBrowserWindow[] = [];
    const manager = new MeasurementWorkerManager({
      ipcMain,
      idleTimeoutMs: 10_000,
      readyTimeoutMs: 50,
      batchTimeoutMs: 50,
      workerHtmlPath: '/tmp/worker.html',
      preloadPath: '/tmp/measurement-preload.js',
      createBrowserWindow: () => {
        const window = new FakeBrowserWindow(ipcMain, () => [
          {
            lineCount: 1,
            contentHeightInches: 0.2,
            totalHeightInches: 0.2,
            maxLineWidthInches: 1.1,
            usedFallback: false,
            warnings: [],
            fitsWidth: true,
            fitsHeight: true,
          },
        ]);
        createdWindows.push(window);
        return window;
      },
    });

    const response = await manager.measureBatch([sampleInput]);

    expect(createdWindows).toHaveLength(1);
    expect(createdWindows[0]?.loadedFilePath).toBe('/tmp/worker.html');
    expect(response.results).toEqual([
      {
        lineCount: 1,
        contentHeightInches: 0.2,
        totalHeightInches: 0.2,
        maxLineWidthInches: 1.1,
        usedFallback: false,
        warnings: [],
        fitsWidth: true,
        fitsHeight: true,
      },
    ]);

    await manager.dispose();
  });

  it('closes the idle worker after the timeout elapses', async () => {
    const ipcMain = new FakeIpcMain();
    const window = new FakeBrowserWindow(ipcMain, () => [
      {
        lineCount: 1,
        contentHeightInches: 0.2,
        totalHeightInches: 0.2,
        maxLineWidthInches: 1,
        usedFallback: false,
        warnings: [],
        fitsWidth: true,
        fitsHeight: true,
      },
    ]);
    const manager = new MeasurementWorkerManager({
      ipcMain,
      idleTimeoutMs: 25,
      readyTimeoutMs: 50,
      batchTimeoutMs: 50,
      workerHtmlPath: '/tmp/worker.html',
      preloadPath: '/tmp/measurement-preload.js',
      createBrowserWindow: () => window,
    });

    await manager.measureBatch([sampleInput]);
    await vi.advanceTimersByTimeAsync(30);

    expect(window.closed).toBe(true);

    await manager.dispose();
  });

  it('recreates the worker after a renderer crash', async () => {
    const ipcMain = new FakeIpcMain();
    const createdWindows: FakeBrowserWindow[] = [];
    const manager = new MeasurementWorkerManager({
      ipcMain,
      idleTimeoutMs: 10_000,
      readyTimeoutMs: 50,
      batchTimeoutMs: 50,
      workerHtmlPath: '/tmp/worker.html',
      preloadPath: '/tmp/measurement-preload.js',
      createBrowserWindow: () => {
        const index = createdWindows.length + 1;
        const window = new FakeBrowserWindow(ipcMain, (requestId) => [
          {
            lineCount: index,
            contentHeightInches: 0.2,
            totalHeightInches: 0.2,
            maxLineWidthInches: 1,
            usedFallback: false,
            warnings: [requestId],
            fitsWidth: true,
            fitsHeight: true,
          },
        ]);
        createdWindows.push(window);
        return window;
      },
    });

    const first = await manager.measureBatch([sampleInput]);
    createdWindows[0]?.crash();
    const second = await manager.measureBatch([sampleInput]);

    expect(first.results[0]).toMatchObject({ lineCount: 1 });
    expect(second.results[0]).toMatchObject({ lineCount: 2 });
    expect(createdWindows).toHaveLength(2);

    await manager.dispose();
  });

  /**
   * H8 回归用：真 Electron 中 BrowserWindow 触发 'closed' 事件时，C++ 层
   * BrowserWindow 已被销毁，再访问 `.webContents` getter 直接抛
   * `TypeError: Object has been destroyed`。`.off()` 同理。
   *
   * 修复前 idle_close → handleClosed → handleWorkerUnavailable 第一行
   * `workerWindow.webContents` 就会让主进程 Uncaught Exception 崩溃。
   * 此测试用 strictDestroyed 模式精确复现该路径。
   */
  it('does not throw when worker window is destroyed during idle close (H8)', async () => {
    const ipcMain = new FakeIpcMain();
    const window = new FakeBrowserWindow(ipcMain, () => [
      {
        lineCount: 1,
        contentHeightInches: 0.2,
        totalHeightInches: 0.2,
        maxLineWidthInches: 1,
        usedFallback: false,
        warnings: [],
        fitsWidth: true,
        fitsHeight: true,
      },
    ], { strictDestroyed: true });
    const manager = new MeasurementWorkerManager({
      ipcMain,
      idleTimeoutMs: 25,
      readyTimeoutMs: 50,
      batchTimeoutMs: 50,
      workerHtmlPath: '/tmp/worker.html',
      preloadPath: '/tmp/measurement-preload.js',
      createBrowserWindow: () => window,
    });

    await manager.measureBatch([sampleInput]);

    // 触发 idle_close 路径，模拟真 Electron 5min 空闲后的关闭
    expect(() => vi.advanceTimersByTime(30)).not.toThrow();
    expect(window.closed).toBe(true);

    // 修好后，下一次 measure 必须能重新 spawn worker（不能因为旧 worker 异常被卡死）
    // 此处用一个全新的、活的 fake window 接管
    const nextWindow = new FakeBrowserWindow(ipcMain, () => [
      {
        lineCount: 2,
        contentHeightInches: 0.2,
        totalHeightInches: 0.2,
        maxLineWidthInches: 1,
        usedFallback: false,
        warnings: [],
        fitsWidth: true,
        fitsHeight: true,
      },
    ]);
    const manager2 = new MeasurementWorkerManager({
      ipcMain,
      idleTimeoutMs: 10_000,
      readyTimeoutMs: 50,
      batchTimeoutMs: 50,
      workerHtmlPath: '/tmp/worker.html',
      preloadPath: '/tmp/measurement-preload.js',
      createBrowserWindow: () => nextWindow,
    });
    const second = await manager2.measureBatch([sampleInput]);
    const recoveredResult = second.results[0];
    if (recoveredResult == null || 'error' in recoveredResult) {
      throw new Error('Expected recovered measurement worker to return a successful result.');
    }
    expect(recoveredResult.lineCount).toBe(2);

    await manager.dispose();
    await manager2.dispose();
  });

  /**
   * H8 回归用（崩溃路径变种）：renderer 进程 crash 后 BrowserWindow 也立刻 close，
   * 整条 handleClosed → handleWorkerUnavailable → detachLifecycle 的访问都
   * 必须在 destroyed 前用缓存 webContents 替代，不能再触摸 destroyed 后的属性。
   */
  it('does not throw when worker crashes and then window closes (H8)', async () => {
    const ipcMain = new FakeIpcMain();
    const window = new FakeBrowserWindow(ipcMain, () => [
      {
        lineCount: 1,
        contentHeightInches: 0.2,
        totalHeightInches: 0.2,
        maxLineWidthInches: 1,
        usedFallback: false,
        warnings: [],
        fitsWidth: true,
        fitsHeight: true,
      },
    ], { strictDestroyed: true });
    const manager = new MeasurementWorkerManager({
      ipcMain,
      idleTimeoutMs: 10_000,
      readyTimeoutMs: 50,
      batchTimeoutMs: 50,
      workerHtmlPath: '/tmp/worker.html',
      preloadPath: '/tmp/measurement-preload.js',
      createBrowserWindow: () => window,
    });

    await manager.measureBatch([sampleInput]);
    expect(() => window.crash()).not.toThrow();
    expect(window.closed).toBe(true);

    await manager.dispose();
  });
});
