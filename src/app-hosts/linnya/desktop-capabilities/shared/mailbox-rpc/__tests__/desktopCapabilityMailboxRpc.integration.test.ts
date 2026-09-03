import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { createAppServerRpcPeer, mergeAppServerRpcHandlerRegistries } from '../../../../app-server-rpc';
import type { DesktopHiddenWorkerHostPort } from '../../../definitions/desktopHiddenWorkerHostPort';
import type { DesktopRasterPdfDocumentPort } from '../../../definitions/desktopRasterPdfDocumentPort';
import type { DesktopTextMeasurementWorkerPort } from '../../../definitions/backendTextMeasurementRuntimeDependencies';
import type { WebPageRenderer } from '../../../../../../tools/web/webread/definitions/webPageRenderer';
import { WebPageRenderError } from '../../../../../../tools/web/webread/definitions/webPageRenderer';
import { createDesktopHiddenWorkerHostRpcClient } from '../../../features/hidden-worker-host-rpc/orchestration/createDesktopHiddenWorkerHostRpcClient';
import { createDesktopHiddenWorkerHostRpcHandlers } from '../../../features/hidden-worker-host-rpc/orchestration/createDesktopHiddenWorkerHostRpcHandlers';
import { createDesktopRasterPdfDocumentRpcClient } from '../../../features/raster-pdf-document-rpc/orchestration/createDesktopRasterPdfDocumentRpcClient';
import { createDesktopRasterPdfDocumentRpcHandlers } from '../../../features/raster-pdf-document-rpc/orchestration/createDesktopRasterPdfDocumentRpcHandlers';
import { createDesktopTextMeasurementWorkerRpcClient } from '../../../features/text-measurement-worker-rpc/orchestration/createDesktopTextMeasurementWorkerRpcClient';
import { createDesktopTextMeasurementWorkerRpcHandlers } from '../../../features/text-measurement-worker-rpc/orchestration/createDesktopTextMeasurementWorkerRpcHandlers';
import { createDesktopWebPageRendererRpcClient } from '../../../features/web-page-renderer-rpc/orchestration/createDesktopWebPageRendererRpcClient';
import { createDesktopWebPageRendererRpcHandlers } from '../../../features/web-page-renderer-rpc/orchestration/createDesktopWebPageRendererRpcHandlers';
import {
  PROTOCOL_VERSION,
  type NormalizedTextMeasureInput,
} from '../../../../../../features/text-measurement/infrastructure/browser-pretext/protocol';
import { resolveBackendRendererRequestMailboxRoot } from '../../../../adapters/backend-renderer-requests';
import { createDesktopCapabilityMailboxRpcClient } from '../orchestration/createDesktopCapabilityMailboxRpcClient';

describe('Desktop capability mailbox RPC', () => {
  it('隐藏 Worker 的注册、ready、大二进制调用与释放保持原 port', async () => {
    const fixture = await createFixture();
    const readyPayload = { workerId: 'slides-raster', protocolVersion: 3 };
    const responseBytes = new Uint8Array(2 * 1024 * 1024).fill(7);
    const port: DesktopHiddenWorkerHostPort = {
      registerHiddenWorker: vi.fn(async () => undefined),
      unregisterHiddenWorker: vi.fn(async () => true),
      ensureHiddenWorkerReady: vi.fn(async () => readyPayload),
      touchHiddenWorker: vi.fn(),
      invokeHiddenWorker: vi.fn(async (_workerId, invocation) => ({
        requestId: invocation.requestId,
        responseBytes,
      })),
      invalidateHiddenWorker: vi.fn(),
    };
    const admission = vi.fn();
    const pair = createPeerPair(
      createDesktopHiddenWorkerHostRpcHandlers({
        port,
        mailboxRoot: fixture.mailboxRoot,
        assertDescriptorAllowed: admission,
      })
    );
    const failures: Error[] = [];
    const client = createDesktopHiddenWorkerHostRpcClient({
      rpc: pair.backend,
      mailbox: createDesktopCapabilityMailboxRpcClient({
        rpc: pair.backend,
        mailboxRoot: fixture.mailboxRoot,
      }),
      onAsyncFailure: error => failures.push(error),
    });

    try {
      const descriptor = {
        id: 'slides-raster',
        requestChannel: 'slides:raster:request',
        responseChannel: 'slides:raster:response',
        readyChannel: 'slides:raster:ready',
        workerHtmlPath: '/bundle/slides/worker.html',
        preloadPath: '/bundle/slides/preload.cjs',
      };
      await client.registerHiddenWorker(descriptor);
      await expect(client.ensureHiddenWorkerReady('slides-raster')).resolves.toEqual(readyPayload);
      const response = await client.invokeHiddenWorker('slides-raster', {
        requestId: 'request-1',
        payload: { slide: 'large-result' },
      });
      expect(readResponseBytes(response)).toEqual(responseBytes);
      client.touchHiddenWorker('slides-raster');
      client.invalidateHiddenWorker('slides-raster', 'invalid response');
      await vi.waitFor(() => expect(port.invalidateHiddenWorker).toHaveBeenCalledOnce());
      await expect(client.unregisterHiddenWorker('slides-raster')).resolves.toBe(true);
      expect(admission).toHaveBeenCalledWith(descriptor);
      expect(failures).toEqual([]);
    } finally {
      pair.dispose();
      await fixture.dispose();
    }
  });

  it('Browser Pretext 批量测量通过 mailbox 往返并保留启动 availability', async () => {
    const fixture = await createFixture();
    const port: DesktopTextMeasurementWorkerPort = {
      availability: { available: true },
      measureBatch: vi.fn(async () => ({
        requestId: 'measurement-response',
        protocolVersion: PROTOCOL_VERSION,
        results: [
          {
            lineCount: 1,
            contentHeightInches: 0.2,
            totalHeightInches: 0.3,
            maxLineWidthInches: 1.1,
            usedFallback: false,
            warnings: [],
          },
        ],
      })),
      measureClusterAdvancesBatch: vi.fn(async () => ({
        requestId: 'cluster-response',
        protocolVersion: PROTOCOL_VERSION,
        results: [],
        clusterResults: [{ advances: [0.1, 0.2] }],
      })),
      touch: vi.fn(),
    };
    const pair = createPeerPair(
      createDesktopTextMeasurementWorkerRpcHandlers({
        port,
        mailboxRoot: fixture.mailboxRoot,
      })
    );
    const failures: Error[] = [];
    const client = createDesktopTextMeasurementWorkerRpcClient({
      rpc: pair.backend,
      mailbox: createDesktopCapabilityMailboxRpcClient({
        rpc: pair.backend,
        mailboxRoot: fixture.mailboxRoot,
      }),
      availability: { available: true },
      onAsyncFailure: error => failures.push(error),
    });

    try {
      expect(client.availability).toEqual({ available: true });
      const result = await client.measureBatch([createMeasurementInput()]);
      expect(result.results[0]).toMatchObject({ lineCount: 1, usedFallback: false });
      const clusterResult = await client.measureClusterAdvancesBatch?.([
        {
          clusters: ['你', '好'],
          style: createMeasurementInput().style,
          sourceKind: 'generated',
        },
      ]);
      expect(clusterResult?.clusterResults?.[0]).toEqual({ advances: [0.1, 0.2] });
      client.touch();
      await vi.waitFor(() => expect(port.touch).toHaveBeenCalledOnce());
      expect(failures).toEqual([]);
    } finally {
      pair.dispose();
      await fixture.dispose();
    }
  });

  it('多页 PNG 与 PDF bytes 不进入 JSON frame', async () => {
    const fixture = await createFixture();
    const pdfBytes = new Uint8Array(3 * 1024 * 1024).fill(9);
    const port: DesktopRasterPdfDocumentPort = {
      render: vi.fn(async () => pdfBytes),
    };
    const pair = createPeerPair(
      createDesktopRasterPdfDocumentRpcHandlers({
        port,
        mailboxRoot: fixture.mailboxRoot,
      })
    );
    const client = createDesktopRasterPdfDocumentRpcClient(
      createDesktopCapabilityMailboxRpcClient({
        rpc: pair.backend,
        mailboxRoot: fixture.mailboxRoot,
      })
    );

    try {
      const request = {
        pageWidthInches: 13.333,
        pageHeightInches: 7.5,
        pages: [new Uint8Array(2 * 1024 * 1024).fill(1)],
      };
      await expect(client.render(request)).resolves.toEqual(pdfBytes);
      expect(port.render).toHaveBeenCalledWith(request);
    } finally {
      pair.dispose();
      await fixture.dispose();
    }
  }, 15_000);

  it('Chromium 网页 DOM 通过 mailbox 往返并保留业务失败类型', async () => {
    const fixture = await createFixture();
    const largeHtml = `<html>${'正文'.repeat(1024 * 1024)}</html>`;
    const port: WebPageRenderer = {
      render: vi.fn(async ({ url }) => {
        if (url.endsWith('/blocked')) {
          throw new WebPageRenderError('navigation_blocked', '拒绝跨站导航');
        }
        return { html: largeHtml, finalUrl: `${url}/rendered` };
      }),
    };
    const pair = createPeerPair(
      createDesktopWebPageRendererRpcHandlers({
        port,
        mailboxRoot: fixture.mailboxRoot,
      })
    );
    const client = createDesktopWebPageRendererRpcClient(
      createDesktopCapabilityMailboxRpcClient({
        rpc: pair.backend,
        mailboxRoot: fixture.mailboxRoot,
      })
    );

    try {
      await expect(
        client.render({
          url: 'https://example.com/article',
          timeoutMs: 30_000,
        })
      ).resolves.toEqual({
        html: largeHtml,
        finalUrl: 'https://example.com/article/rendered',
      });
      await expect(
        client.render({
          url: 'https://example.com/blocked',
        })
      ).rejects.toEqual(
        expect.objectContaining({
          name: 'WebPageRenderError',
          kind: 'navigation_blocked',
        })
      );
    } finally {
      pair.dispose();
      await fixture.dispose();
    }
  });
});

function createPeerPair(handlers: ReturnType<typeof mergeAppServerRpcHandlerRegistries>) {
  const desktopToBackend = new PassThrough();
  const backendToDesktop = new PassThrough();
  const desktop = createAppServerRpcPeer({
    input: backendToDesktop,
    output: desktopToBackend,
    handlers,
  });
  const backend = createAppServerRpcPeer({
    input: desktopToBackend,
    output: backendToDesktop,
    handlers: new Map(),
  });
  return {
    backend,
    dispose() {
      desktop.dispose();
      backend.dispose();
      desktopToBackend.destroy();
      backendToDesktop.destroy();
    },
  };
}

async function createFixture() {
  const appDataRoot = await mkdtemp(path.join(os.tmpdir(), 'linnya-desktop-capability-rpc-'));
  return {
    mailboxRoot: resolveBackendRendererRequestMailboxRoot(appDataRoot),
    dispose: () => rm(appDataRoot, { recursive: true, force: true }),
  };
}

function createMeasurementInput(): NormalizedTextMeasureInput {
  return {
    paragraphs: [{ text: '你好 Linnya' }],
    style: {
      fontSizePt: 18,
      bold: false,
      italic: false,
      lineHeightMultiplier: 1.2,
    },
    box: {
      widthInches: 4,
      wrap: 'word',
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      usableWidthInches: 4,
    },
    sourceKind: 'generated',
  };
}

function readResponseBytes(value: unknown): Uint8Array {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Hidden worker response 必须是对象');
  }
  const bytes = Reflect.get(value, 'responseBytes');
  if (!(bytes instanceof Uint8Array)) throw new Error('Hidden worker response 缺少 bytes');
  return bytes;
}
