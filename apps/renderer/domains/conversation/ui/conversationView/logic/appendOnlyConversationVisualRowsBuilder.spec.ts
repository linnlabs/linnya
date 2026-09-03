import { describe, expect, it } from 'vitest';
import type { BaseMessage } from '../../../types';
import type { ConversationToolMessageMetadata } from '@app/schemas';
import {
  createTestAnswerMessage,
  createTestThoughtMessage,
  createTestToolMessage,
  createTestUserMessage,
} from '../../../testing/functions/createConversationTestMessage';
import { estimateConversationMessageLayout } from '../utils/contentHeightEstimator';
import { createAppendOnlyConversationVisualRowsBuilder } from './appendOnlyConversationVisualRowsBuilder';
import { projectConversationVisualRows, type ProjectConversationVisualRowsOptions } from './projectConversationVisualRows';

function message(
  id: string,
  role: BaseMessage['role'],
  type: BaseMessage['type'],
  content: string,
  metadata?: Partial<ConversationToolMessageMetadata> & {
    readonly ui?: { readonly presentation: 'message' | 'hidden' };
  },
): BaseMessage {
  if (type === 'user_input') return createTestUserMessage({ id, content, metadata });
  if (type === 'thought') return createTestThoughtMessage({ id, content });
  if (type === 'tool_calls') return createTestToolMessage({ id, content, metadata });
  return createTestAnswerMessage({ id, content, type: type === 'tool_preamble' || type === 'partial_answer' ? type : 'final_answer' });
}

function expectIncrementalParity(steps: Array<{
  messages: BaseMessage[];
  options?: ProjectConversationVisualRowsOptions;
}>): void {
  const builder = createAppendOnlyConversationVisualRowsBuilder();
  for (const step of steps) {
    expect(builder.apply(step.messages, step.options ?? {})).toEqual(
      projectConversationVisualRows(step.messages, step.options),
    );
  }
}

describe('createAppendOnlyConversationVisualRowsBuilder', () => {
  it('matches full projection while visible and filtered messages append', () => {
    const source: BaseMessage[] = [message('u1', 'user', 'user_input', 'question')];
    expectIncrementalParity([
      { messages: source.slice() },
      { messages: [...source, message('hidden', 'user', 'user_input', 'internal', { ui: { presentation: 'hidden' } })] },
      { messages: [...source, message('t1', 'assistant', 'thought', 'working')] },
      { messages: [...source, message('t1', 'assistant', 'thought', 'working'), message('a1', 'assistant', 'final_answer', 'done')] },
    ]);
  });

  it('rebuilds after history window truncation without stale rows', () => {
    const builder = createAppendOnlyConversationVisualRowsBuilder();
    const full = [
      message('u1', 'user', 'user_input', 'first'),
      message('a1', 'assistant', 'final_answer', 'answer'),
      message('u2', 'user', 'user_input', 'second'),
      message('a2', 'assistant', 'final_answer', 'answer'),
    ];
    builder.apply(full, {});
    expect(builder.apply(full.slice(0, 2), {}).map(row => row.key)).toEqual(['msg_u1', 'msg_a1']);
    expect(builder.getDiagnostics().fullRebuilds).toBe(2);
  });

  it('analyzes only the changing tail row during streaming', () => {
    const history = Array.from({ length: 100 }, (_, index): BaseMessage[] => [
      message(`u${index}`, 'user', 'user_input', `question ${index}`),
      message(`a${index}`, 'assistant', 'final_answer', `answer ${index}`),
    ]).flat();
    const streaming = message('stream', 'assistant', 'final_answer', 'start');
    const source = [...history, streaming];
    let layoutAnalysisCalls = 0;
    const builder = createAppendOnlyConversationVisualRowsBuilder({
      estimateMessageLayout: (current, registry, widthPx) => {
        layoutAnalysisCalls += 1;
        return estimateConversationMessageLayout(current, registry, widthPx);
      },
    });

    builder.apply(source, {});
    layoutAnalysisCalls = 0;
    for (let index = 0; index < 100; index += 1) {
      streaming.content += ` chunk-${index}`;
      expect(builder.apply(source, {})).toEqual(projectConversationVisualRows(source));
    }

    expect(layoutAnalysisCalls).toBe(100);
    expect(builder.getDiagnostics()).toMatchObject({ fullRebuilds: 1, tailContentUpdates: 100 });
  });

  it('reprojects a questionnaire when only its structured args are completed', () => {
    const builder = createAppendOnlyConversationVisualRowsBuilder();
    const loadingQuestionnaire = message(
      'ask-questions',
      'assistant',
      'tool_calls',
      '',
      {
        tool_name: 'ask',
        tool_call_id: 'call-ask-questions',
        status: 'loading',
      },
    );
    const source = [loadingQuestionnaire];

    builder.apply(source, {});

    if (loadingQuestionnaire.type !== 'tool_calls') throw new Error('Expected questionnaire tool');
    source[0] = createTestToolMessage({
      ...loadingQuestionnaire,
      metadata: {
        ...loadingQuestionnaire.metadata,
        args: {
          questions: [{ id: 'audience', prompt: 'Who is the audience?' }],
        },
      },
    });

    expect(builder.apply(source, {})).toEqual(projectConversationVisualRows(source));
    expect(builder.getDiagnostics()).toMatchObject({
      fullRebuilds: 1,
      messageRevisionUpdates: 1,
    });
  });

  it('reprojects a revised non-tail parent tool row while later messages already exist', () => {
    const builder = createAppendOnlyConversationVisualRowsBuilder();
    const parentTool = message(
      'parent-tool',
      'assistant',
      'tool_calls',
      '',
      {
        tool_name: 'subagent',
        tool_call_id: 'parent-call',
        status: 'loading',
        subrunTraceVersion: 1,
      },
    );
    const source = [
      message('user', 'user', 'user_input', 'question'),
      parentTool,
      message('later-thought', 'assistant', 'thought', 'parent continues'),
    ];
    builder.apply(source, {});

    if (parentTool.type !== 'tool_calls') throw new Error('Expected parent tool');
    source[1] = createTestToolMessage({
      ...parentTool,
      metadata: {
        ...parentTool.metadata,
        subrunTraceVersion: 2,
      },
    });

    const rows = builder.apply(source, {});
    expect(rows).toEqual(projectConversationVisualRows(source));
    if (rows[1]?.payload.type !== 'tool_calls') throw new Error('Expected projected parent tool row');
    expect(rows[1].payload.metadata.subrunTraceVersion).toBe(2);
    expect(builder.getDiagnostics()).toMatchObject({
      fullRebuilds: 1,
      messageRevisionUpdates: 1,
    });
  });
});
