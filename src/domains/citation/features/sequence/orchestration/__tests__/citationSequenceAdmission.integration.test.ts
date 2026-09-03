import { describe, expect, it } from 'vitest';
import { createToolOutputEvent } from 'linnkit/contracts';
import { ensureToolContextRuntimeCapability } from 'linnkit/runtime-kernel';
import { decorateCitationSequenceToolContext } from '../../../../../../app-hosts/linnya/adapters/tools/citationSequenceToolContextDecorator';
import {
  requireCitationSequenceOffset,
} from '../citationSequenceContext';

function createCitationOutput(params: {
  readonly id: string;
  readonly turnId: string;
  readonly count: number;
}) {
  return createToolOutputEvent(
    params.id,
    'citation-sequence-conversation',
    params.turnId,
    'knowledge_search',
    `call-${params.id}`,
    {
      status: 'success',
      observation: 'citation output',
      data: {
        citations: {
          citations: Array.from({ length: params.count }, (_, index) => ({ index: index + 1 })),
        },
      },
    },
  );
}

describe('Citation sequence host admission', () => {
  it('同一 turn 随 working history 连续增长，切换 turn 后重新从零开始', () => {
    const firstOutput = createCitationOutput({ id: 'first', turnId: 'turn-a', count: 2 });
    const secondOutput = createCitationOutput({ id: 'second', turnId: 'turn-a', count: 1 });
    const context = {};
    const binding = ensureToolContextRuntimeCapability({
      context,
      persistedHistory: [],
      workingHistory: [firstOutput],
      executionMeta: {
        conversationId: 'citation-sequence-conversation',
        turnId: 'turn-a',
      },
    });

    decorateCitationSequenceToolContext(context);
    expect(requireCitationSequenceOffset(context)).toBe(2);

    binding.setWorkingHistorySource([firstOutput, secondOutput]);
    decorateCitationSequenceToolContext(context);
    expect(requireCitationSequenceOffset(context)).toBe(3);

    binding.bindExecutionMeta({ turnId: 'turn-b' });
    decorateCitationSequenceToolContext(context);
    expect(requireCitationSequenceOffset(context)).toBe(0);
  });

  it('producer 未经过 host admission 时明确失败', () => {
    expect(() => requireCitationSequenceOffset({})).toThrow(
      'Citation producer requires a host-admitted citation sequence.',
    );
  });
});
