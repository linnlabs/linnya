import { describe, expect, it } from 'vitest';

import type { BaseMessage } from '../../../types';
import { createTestAnswerMessage } from '../../../testing/functions/createConversationTestMessage';
import {
  isAnswerSegmentStreaming,
  isVisualTurnOwnedByActiveRun,
} from './conversationRunRendering';

function answer(input: {
  readonly id: string;
  readonly runId: string;
  readonly isComplete: boolean;
}): BaseMessage {
  return createTestAnswerMessage({
    id: input.id,
    metadata: {
      run_id: input.runId,
      is_complete: input.isComplete,
    },
  });
}

describe('message canvas run rendering identity', () => {
  it('只让属于 active run 的 turn 进入 streaming 生命周期', () => {
    const oldAnswer = answer({ id: 'old', runId: 'run-old', isComplete: true });
    const activeAnswer = answer({ id: 'active', runId: 'run-active', isComplete: false });

    expect(isVisualTurnOwnedByActiveRun([oldAnswer], ['run-active'])).toBe(false);
    expect(isVisualTurnOwnedByActiveRun([activeAnswer], ['run-active'])).toBe(true);
    expect(isAnswerSegmentStreaming(activeAnswer, true)).toBe(true);
    expect(isAnswerSegmentStreaming(oldAnswer, false)).toBe(false);
  });

  it('run 仍忙碌时，已经 seal 的 answer segment 不再保持 Markdown streaming', () => {
    const sealed = answer({ id: 'sealed', runId: 'run-active', isComplete: true });

    expect(isVisualTurnOwnedByActiveRun([sealed], ['run-active'])).toBe(true);
    expect(isAnswerSegmentStreaming(sealed, true)).toBe(false);
  });

  it('annotation activity 使用同一 run identity 参与归属判断', () => {
    const annotationAnswer: BaseMessage = createTestAnswerMessage({
      id: 'annotation-answer',
      content: 'annotation',
      metadata: {
        run_id: 'annotation-run',
        activity: { runId: 'annotation-run', feature: 'annotation' },
        is_complete: false,
      },
    });

    expect(isVisualTurnOwnedByActiveRun([annotationAnswer], ['annotation-run'])).toBe(true);
  });
});
