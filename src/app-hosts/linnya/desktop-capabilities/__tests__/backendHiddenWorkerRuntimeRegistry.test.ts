import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearBackendHiddenWorkerRuntimePortForTesting,
  getBackendHiddenWorkerRuntimePort,
  installBackendHiddenWorkerRuntimePort,
  type BackendHiddenWorkerRuntimePort,
} from '..';

afterEach(clearBackendHiddenWorkerRuntimePortForTesting);

describe('Backend hidden worker runtime registry', () => {
  it('冻结同一 App owner 的唯一 hidden worker runtime', () => {
    const port = createPort();
    installBackendHiddenWorkerRuntimePort(port);
    installBackendHiddenWorkerRuntimePort(port);

    expect(getBackendHiddenWorkerRuntimePort()).toBe(port);
    expect(() => installBackendHiddenWorkerRuntimePort(createPort()))
      .toThrow('已安装另一实现');
  });
});

function createPort(): BackendHiddenWorkerRuntimePort {
  return Object.freeze({
    registerHiddenWorker: vi.fn(async () => undefined),
    unregisterHiddenWorker: vi.fn(async () => false),
    hasHiddenWorker: vi.fn(() => false),
    listHiddenWorkerIds: vi.fn(() => []),
    ensureHiddenWorkerReady: vi.fn(async () => undefined),
    touchHiddenWorker: vi.fn(),
    invokeHiddenWorker: vi.fn(async () => undefined),
  });
}
