import { describe, expect, it, vi } from 'vitest';
import type { SlidesManualEditCommand } from '@plugin/slides/shared/authoringEditing';
import { ManualEditPresentationTrace } from './ManualEditPresentationTrace.js';

const COMMAND: SlidesManualEditCommand = {
  commandId: 'command-1',
  documentId: 'deck-1',
  expectedBase: { revisionId: 'revision-1', revision: 1, sourceHash: 'hash-1' },
  operation: {
    op: 'translate_by',
    target: { slideKey: 'slide-1', editKey: 'shape-1' },
    targetKind: 'shape',
    delta: { dx: 1, dy: 2 },
  },
};

describe('ManualEditPresentationTrace', () => {
  it('用同一 commandId 记录 input 到完整帧的阶段耗时', () => {
    let time = 0;
    const log = vi.fn();
    const trace = new ManualEditPresentationTrace({ now: () => time, log });

    trace.begin(COMMAND);
    time = 20;
    trace.recordResponse({
      status: 'committed',
      commandId: COMMAND.commandId,
      documentId: COMMAND.documentId,
      revisionId: 'revision-2',
      revision: 2,
    });
    time = 30;
    trace.recordRefreshCompleted(COMMAND.commandId);
    time = 40;
    trace.recordPresented(COMMAND.documentId, 2);

    expect(log).toHaveBeenLastCalledWith('frame_presented', expect.objectContaining({
      commandId: 'command-1',
      revision: 2,
      inputToResponseMs: 20,
      responseToRefreshMs: 10,
      refreshToFrameMs: 10,
      inputToFrameMs: 40,
    }));
  });

  it('保留 frame 先于 IPC response 到达的竞态事实并最终闭合 trace', () => {
    let time = 0;
    const log = vi.fn();
    const trace = new ManualEditPresentationTrace({ now: () => time, log });
    trace.begin(COMMAND);
    time = 10;
    trace.recordPresented(COMMAND.documentId, 2);
    time = 20;
    trace.recordResponse({
      status: 'committed',
      commandId: COMMAND.commandId,
      documentId: COMMAND.documentId,
      revisionId: 'revision-2',
      revision: 2,
    });
    time = 30;
    trace.recordRefreshCompleted(COMMAND.commandId);

    expect(log).toHaveBeenLastCalledWith('frame_presented', expect.objectContaining({
      inputToFrameMs: 10,
      refreshToFrameMs: -20,
    }));
  });
});
