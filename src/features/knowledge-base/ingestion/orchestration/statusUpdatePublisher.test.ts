import { describe, expect, it, vi } from 'vitest';

import { FrontendStatus, InternalStage } from '../definitions/state';
import { createRendererStatusUpdatePublisher } from './statusUpdatePublisher';

describe('createRendererStatusUpdatePublisher', () => {
  it('保持既有 task-status-update 字段并且不携带状态机上下文', () => {
    const publish = vi.fn();
    const publisher = createRendererStatusUpdatePublisher(publish);

    publisher({
      taskId: 'task-1',
      docId: 'doc-1',
      filename: 'a.pdf',
      stage: InternalStage.PARSING,
      frontendState: {
        status: FrontendStatus.PROCESSING,
        stage: InternalStage.PARSING,
        progress: 20,
        stage_progress: 30,
        message: '解析中',
        doc_id: 'doc-1',
        filename: 'a.pdf',
        updated_at: 123,
      },
    });

    expect(publish).toHaveBeenCalledWith({
      taskId: 'task-1',
      docId: 'doc-1',
      filename: 'a.pdf',
      status: FrontendStatus.PROCESSING,
      progress: 20,
      message: '解析中',
      error: undefined,
      stage: InternalStage.PARSING,
      stage_progress: 30,
      updated_at: 123,
      timestamp: 123,
    });
  });
});
