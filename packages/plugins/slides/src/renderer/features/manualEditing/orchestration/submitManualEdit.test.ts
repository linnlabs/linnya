import { describe, expect, it, vi } from 'vitest';
import { submitManualEdit } from './submitManualEdit';

const input = {
  documentId: 'deck-1',
  buildState: {
    state: 'ready' as const,
    presentationId: 'deck-1',
    versionId: 'revision-3',
    versionNumber: 3,
    sourceHash: 'a'.repeat(64),
  },
  renderVersion: 3,
  operation: {
    op: 'translate_by' as const,
    target: { slideKey: 'overview', editKey: 'hero' },
    targetKind: 'image' as const,
    delta: { dx: 0.2, dy: -0.1 },
  },
};

describe('submitManualEdit', () => {
  it('submits an exact snapshot command and reports commit independently of presentation', async () => {
    const submit = vi.fn(async command => ({
      status: 'committed' as const,
      commandId: command.commandId,
      documentId: command.documentId,
      revisionId: 'revision-4',
      revision: 4,
    }));
    const trace = {
      begin: vi.fn(),
      recordTransportRetry: vi.fn(),
      recordResponse: vi.fn(),
      recordTransportFailure: vi.fn(),
      recordRefreshCompleted: vi.fn(),
      recordPresented: vi.fn(),
      clear: vi.fn(),
    };

    await expect(submitManualEdit(input, {
      createCommandId: () => 'c8356051-a487-4cd3-863f-47db0079f991',
      submit,
      trace,
    })).resolves.toMatchObject({ status: 'committed', revision: 4 });
    expect(submit).toHaveBeenCalledWith({
      commandId: 'c8356051-a487-4cd3-863f-47db0079f991',
      documentId: 'deck-1',
      expectedBase: {
        revisionId: 'revision-3',
        revision: 3,
        sourceHash: 'a'.repeat(64),
      },
      operation: input.operation,
    });
    expect(trace.begin).toHaveBeenCalledWith(submit.mock.calls[0]?.[0]);
    expect(trace.recordResponse).toHaveBeenCalledWith(expect.objectContaining({ revision: 4 }));

  });

  it('does not submit when the displayed model is behind the build snapshot', async () => {
    const submit = vi.fn();
    await expect(submitManualEdit({ ...input, renderVersion: 2 }, {
      createCommandId: () => 'unused',
      submit,
    })).resolves.toEqual({ status: 'snapshot_unavailable' });
    expect(submit).not.toHaveBeenCalled();
  });

  it('reports conflicts and validation failures for queue orchestration', async () => {
    const conflict = await submitManualEdit(input, {
      createCommandId: () => 'c8356051-a487-4cd3-863f-47db0079f991',
      submit: vi.fn(async () => ({
        status: 'conflict', commandId: 'id', documentId: 'deck-1', reason: 'stale_base',
      })),
    });
    expect(conflict.status).toBe('conflict');

    await submitManualEdit(input, {
      createCommandId: () => 'c8356051-a487-4cd3-863f-47db0079f991',
      submit: vi.fn(async () => ({
        status: 'validation_failed', commandId: 'id', documentId: 'deck-1',
        code: 'operation_invalid', message: 'Invalid operation',
      })),
    });
  });

  it('retries an ambiguous transport failure with the same idempotent command', async () => {
    const submit = vi.fn()
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockImplementationOnce(async command => ({
        status: 'committed' as const,
        commandId: command.commandId,
        documentId: command.documentId,
        revisionId: 'revision-4',
        revision: 4,
      }));

    await expect(submitManualEdit(input, {
      createCommandId: () => 'c8356051-a487-4cd3-863f-47db0079f991',
      submit,
    })).resolves.toMatchObject({ status: 'committed', revision: 4 });
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[0]?.[0]).toEqual(submit.mock.calls[1]?.[0]);
  });
});
