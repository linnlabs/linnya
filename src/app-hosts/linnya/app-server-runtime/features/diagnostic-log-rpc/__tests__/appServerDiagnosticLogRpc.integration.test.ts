import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import {
  createDiagnosticLogEnvelope,
  DEFAULT_DIAGNOSTIC_LOG_PROJECTION_LIMITS,
  projectDiagnosticLogEntry,
} from '../../../../../../shared/logging';
import { createAppServerRpcPeer } from '../../../../app-server-rpc';
import { createAppServerDiagnosticLogForwarder } from '../orchestration/createAppServerDiagnosticLogForwarder';
import { createDesktopDiagnosticLogRpcHandlers } from '../orchestration/createDesktopDiagnosticLogRpcHandlers';

describe('App Server diagnostic log RPC', () => {
  it('把 Backend 已投影记录交给 Desktop 唯一 writer', async () => {
    const desktopToBackend = new PassThrough();
    const backendToDesktop = new PassThrough();
    const written: string[] = [];
    const desktop = createAppServerRpcPeer({
      input: backendToDesktop,
      output: desktopToBackend,
      handlers: createDesktopDiagnosticLogRpcHandlers({
        writeRecord: record => written.push(record.line),
      }),
    });
    const backend = createAppServerRpcPeer({
      input: desktopToBackend,
      output: backendToDesktop,
      handlers: new Map(),
    });
    const forward = createAppServerDiagnosticLogForwarder(backend);
    const record = projectDiagnosticLogEntry({
      receivedAt: new Date('2026-08-28T12:00:00.000Z'),
      level: 'INFO',
      module: 'App-Server-Backend',
      message: 'ready',
    }, DEFAULT_DIAGNOSTIC_LOG_PROJECTION_LIMITS);

    forward(createDiagnosticLogEnvelope(record));
    await expect.poll(() => written).toEqual([record.line]);

    desktop.dispose();
    backend.dispose();
    desktopToBackend.destroy();
    backendToDesktop.destroy();
  });
});
