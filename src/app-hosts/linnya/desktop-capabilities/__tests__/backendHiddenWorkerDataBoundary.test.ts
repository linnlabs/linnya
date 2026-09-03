import { describe, expect, it, vi } from 'vitest';

import type { HiddenWorkerDefinition } from '@linnya/plugin-host-contract/backend/hiddenWorkerRuntime';
import {
  createBackendHiddenWorkerRuntime,
  type DesktopHiddenWorkerDescriptor,
  type DesktopHiddenWorkerHostPort,
  type DesktopHiddenWorkerInvocation,
} from '..';

describe('Backend hidden worker data boundary', () => {
  it('codec 留在 Backend，Desktop 只收到 descriptor 与已编码 envelope', async () => {
    let registeredDescriptor: DesktopHiddenWorkerDescriptor | null = null;
    let receivedInvocation: DesktopHiddenWorkerInvocation | null = null;
    const desktopHost: DesktopHiddenWorkerHostPort = {
      registerHiddenWorker: async (descriptor) => {
        registeredDescriptor = descriptor;
      },
      unregisterHiddenWorker: async () => true,
      ensureHiddenWorkerReady: async () => ({ protocolVersion: 3 }),
      touchHiddenWorker: vi.fn(),
      invokeHiddenWorker: async (_workerId, invocation) => {
        receivedInvocation = invocation;
        return { requestId: invocation.requestId, result: { ok: true } };
      },
      invalidateHiddenWorker: vi.fn(),
    };
    const definition: HiddenWorkerDefinition = {
      id: 'demo-worker',
      requestChannel: 'demo:request',
      responseChannel: 'demo:response',
      readyChannel: 'demo:ready',
      cancelChannel: 'demo:cancel',
      workerHtmlPath: '/plugin/worker.html',
      preloadPath: '/plugin/preload.js',
      createRequestPayload: (request) => ({
        requestId: readStringField(request, 'requestId'),
        payload: { requestId: readStringField(request, 'requestId'), command: 'render' },
      }),
      createCancelPayload: (requestId) => ({ requestId }),
      parseReadyPayload: (payload) => {
        if (readNumberField(payload, 'protocolVersion') !== 3) {
          throw new Error('unsupported protocol');
        }
      },
      parseResponsePayload: (payload) => ({
        requestId: readStringField(payload, 'requestId'),
        response: Reflect.get(requireRecord(payload), 'result'),
      }),
    };
    const runtime = createBackendHiddenWorkerRuntime(desktopHost);

    await runtime.registerHiddenWorker(definition);
    await expect(runtime.invokeHiddenWorker('demo-worker', { requestId: 'request-1' }))
      .resolves.toEqual({ ok: true });

    expect(registeredDescriptor).toEqual({
      id: 'demo-worker',
      requestChannel: 'demo:request',
      responseChannel: 'demo:response',
      readyChannel: 'demo:ready',
      cancelChannel: 'demo:cancel',
      workerHtmlPath: '/plugin/worker.html',
      preloadPath: '/plugin/preload.js',
    });
    expect(Object.values(registeredDescriptor ?? {}).some(value => typeof value === 'function'))
      .toBe(false);
    expect(receivedInvocation).toEqual({
      requestId: 'request-1',
      payload: { requestId: 'request-1', command: 'render' },
      cancelPayload: { requestId: 'request-1' },
    });
  });
});

function requireRecord(value: unknown): object {
  if (value == null || typeof value !== 'object') {
    throw new Error('expected record');
  }
  return value;
}

function readStringField(value: unknown, field: string): string {
  const fieldValue = Reflect.get(requireRecord(value), field);
  if (typeof fieldValue !== 'string') {
    throw new Error(`${field} must be a string`);
  }
  return fieldValue;
}

function readNumberField(value: unknown, field: string): number {
  const fieldValue = Reflect.get(requireRecord(value), field);
  if (typeof fieldValue !== 'number') {
    throw new Error(`${field} must be a number`);
  }
  return fieldValue;
}
