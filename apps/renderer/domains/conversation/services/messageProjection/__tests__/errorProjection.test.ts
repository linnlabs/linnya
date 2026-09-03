import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import {
  createErrorEvent,
  runtimeEventToSSEEvent,
  validateRuntimeEvent,
  RunIdSchema,
} from '@linnlabs/linnkit/contracts';
import { projectEventsWithMemoryApplier } from 'src/app-hosts/linnya/adapters/persistence/event-store/ui-projection';
import type { Conversation } from '../../../types';
import { createInitialProjectionState, reduceEvent } from '..';
import { runtimeEventToFrontendProjectionEvent } from './helpers/runtimeEventToFrontendProjectionEvent';
import { PROJECTION_TEST_SCOPE } from './helpers/projectionTestScope';

function createConversation(): Conversation {
  return {
    id: 'conv-error-projection',
    title: 'error projection',
    titleOrigin: 'explicit',
    createdAt: 1,
    updatedAt: 1,
    messages: [],
    selectedAgentId: null,
  };
}

describe('conversation image error projection', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('live SSE 与 durable replay 使用同一友好文案，窗口 read model 不伪造错误消息行', () => {
    const runtimeEvent = createErrorEvent(
      'error-image-1',
      'conv-error-projection',
      'turn-1',
      '{"provider":"raw-body"}',
      {
        run_id: RunIdSchema.parse(PROJECTION_TEST_SCOPE.run_id),
        lane: 'foreground',
        visibility: 'conversation',
        error_code: 'llm.image_input.model_unsupported',
        retryable: false,
        details: {
          stack: 'provider stack must not enter ErrorBanner',
          metadata: { compatible_model_ids: ['vision-model'] },
        },
      }
    );
    const liveEvent = runtimeEventToSSEEvent(runtimeEvent);
    const replayPayload: unknown = JSON.parse(JSON.stringify(runtimeEvent));
    const replayValidation = validateRuntimeEvent(replayPayload);
    expect(liveEvent).not.toBeNull();
    expect(replayValidation.success).toBe(true);
    if (!liveEvent || !replayValidation.success) {
      throw new Error('error projection fixture validation failed');
    }
    const replayEvent = runtimeEventToFrontendProjectionEvent(
      replayValidation.data,
      PROJECTION_TEST_SCOPE
    );
    expect(replayEvent).not.toBeNull();
    if (!replayEvent) throw new Error('replay error projection is missing');

    const liveResult = reduceEvent(createInitialProjectionState(createConversation()), liveEvent);
    const replayResult = reduceEvent(
      createInitialProjectionState(createConversation()),
      replayEvent
    );

    expect(liveResult.error).toBe('当前模型不支持图片识别，可切换到：vision-model。');
    expect(replayResult.error).toBe(liveResult.error);
    expect(liveResult.error).not.toContain('raw-body');
    expect(liveResult.error).not.toContain('provider stack');

    const windowProjection = projectEventsWithMemoryApplier([runtimeEvent]);
    expect(windowProjection.rows).toEqual([]);
    expect(windowProjection.skipped).toEqual([
      expect.objectContaining({
        eventId: 'error-image-1',
        reason: 'error-event-is-surface-state-not-timeline-row',
      }),
    ]);
  });
});
