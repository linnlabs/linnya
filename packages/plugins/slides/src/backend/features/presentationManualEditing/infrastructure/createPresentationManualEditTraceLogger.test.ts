import { describe, expect, it, vi } from 'vitest';
import { createPresentationManualEditTraceLogger } from './createPresentationManualEditTraceLogger.js';

describe('createPresentationManualEditTraceLogger', () => {
  it('以 commandId 关联 backend 阶段并在终态释放计时状态', () => {
    let now = 100;
    const info = vi.fn();
    const trace = createPresentationManualEditTraceLogger(
      { debug: vi.fn(), info, warn: vi.fn(), error: vi.fn() },
      () => now,
    );
    trace.record({ commandId: 'command-1', documentId: 'deck-1', stage: 'request_received' });
    now = 125;
    trace.record({
      commandId: 'command-1',
      documentId: 'deck-1',
      stage: 'semantic_build_started',
      path: 'projected_translation',
    });
    now = 140;
    trace.record({
      commandId: 'command-1',
      documentId: 'deck-1',
      stage: 'revision_committed',
      outcome: 'committed',
      revision: 2,
    });

    expect(info).toHaveBeenLastCalledWith('slides_manual_edit.backend_trace', expect.objectContaining({
      commandId: 'command-1',
      elapsedMs: 40,
      revision: 2,
    }));
  });
});
