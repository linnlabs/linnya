import { describe, expect, it } from 'vitest';
import type { SSESubRunTraceEvent } from 'linnkit/contracts';

import type { BaseMessage } from '../../../types';
import type { SubrunTraceBucketMap } from '../../subrun-trace';
import {
  buildSubrunTraceBuckets,
  createSubrunTraceAccumulator,
} from '../../subrun-trace';
import {
  createSubrunMessageProjectionState,
  projectSubrunTraceEvent,
} from '../functions/projectSubrunTraceEvent';
import { ToolCallIdSchema } from 'linnkit/contracts';

function answerChunk(params: {
  id: string;
  sourceEventId: string;
  seq: number;
  delta: string;
  isLast?: boolean;
}): SSESubRunTraceEvent {
  return {
    type: 'subrun_trace',
    id: params.id,
    conversation_id: 'conversation-1',
    turn_id: 'turn-child-1',
    timestamp: params.seq + 1,
    parent_tool_call_id: ToolCallIdSchema.parse('parent-call-1'),
    subrun_id: 'subrun-1',
    source_event_id: params.sourceEventId,
    kind: 'final_answer_chunk',
    answer_id: 'answer-1',
    seq: params.seq,
    delta: params.delta,
    ...(params.isLast ? { is_last: true } : {}),
  };
}

function terminalAnswer(): SSESubRunTraceEvent {
  return {
    type: 'subrun_trace',
    id: 'trace-terminal',
    conversation_id: 'conversation-1',
    turn_id: 'turn-child-1',
    timestamp: 4,
    parent_tool_call_id: ToolCallIdSchema.parse('parent-call-1'),
    subrun_id: 'subrun-1',
    source_event_id: 'source-terminal',
    kind: 'final_answer',
    answer_id: 'answer-1',
    content: '完整答案',
    completion_reason: 'terminal',
  };
}

function buckets(events: readonly SSESubRunTraceEvent[]): SubrunTraceBucketMap {
  return { 'subrun-1': { subrun_id: 'subrun-1', events } };
}

function project(events: readonly SSESubRunTraceEvent[]): BaseMessage[] {
  const state = createSubrunMessageProjectionState();
  const messages: BaseMessage[] = [];
  events.forEach((event, index) => {
    expect(projectSubrunTraceEvent(state, messages, event, index).success).toBe(true);
  });
  return messages;
}

describe('subrun live + historical projection', () => {
  it('紧凑 final_answer 历史快照可独立重建正文，实时协议仍由 chunk 创建正文', () => {
    const historical = buildSubrunTraceBuckets([
      {
        type: 'subrun_trace',
        id: 'trace-terminal',
        conversation_id: 'conversation-1',
        turn_id: 'turn-child-1',
        timestamp: 4,
        version: 1,
        ephemeral: true,
        parent_tool_call_id: ToolCallIdSchema.parse('parent-call-1'),
        subrun_id: 'subrun-1',
        source_event_id: 'source-terminal',
        kind: 'final_answer',
        answer_id: 'answer-1',
        content: '完整答案',
        completion_reason: 'terminal',
      },
    ], { origin: 'historical' });
    const events = historical['subrun-1']?.events ?? [];

    expect(events.map(event => event.kind)).toEqual(['final_answer_chunk', 'final_answer']);
    expect(events.map(event => event.id)).toEqual([
      'trace-terminal:snapshot-chunk',
      'trace-terminal',
    ]);
    expect(project(events)).toMatchObject([{
      type: 'final_answer',
      content: '完整答案',
      metadata: {
        answer_id: 'answer-1',
        seal_source_event_id: 'source-terminal',
        is_complete: true,
      },
    }]);
  });

  it('live 同 source 到达后整体取代历史 one-shot 投影，不重复答案正文', () => {
    const historical = buildSubrunTraceBuckets([
      {
        type: 'subrun_trace',
        id: 'trace-terminal-history',
        conversation_id: 'conversation-1',
        turn_id: 'turn-child-1',
        timestamp: 4,
        version: 1,
        ephemeral: true,
        parent_tool_call_id: ToolCallIdSchema.parse('parent-call-1'),
        subrun_id: 'subrun-1',
        source_event_id: 'source-terminal',
        kind: 'final_answer',
        answer_id: 'answer-1',
        content: '完整答案',
        completion_reason: 'terminal',
      },
    ], { origin: 'historical' });
    const live = buckets([
      answerChunk({ id: 'live-0', sourceEventId: 'source-0', seq: 0, delta: '完整' }),
      answerChunk({ id: 'live-1', sourceEventId: 'source-1', seq: 1, delta: '答案', isLast: true }),
      terminalAnswer(),
    ]);
    const accumulator = createSubrunTraceAccumulator();
    accumulator.admitHistorical(historical);
    accumulator.admitLive(live);
    const events = accumulator.read()?.['subrun-1']?.events ?? [];

    expect(events.map(event => event.id)).toEqual(['live-0', 'live-1', 'trace-terminal']);
    expect(project(events)).toHaveLength(1);
    expect(project(events)[0]?.content).toBe('完整答案');
  });

  it('历史前缀与 live 重叠尾部只投影一份答案，重载结果与实时结束态一致', () => {
    const historicalPrefix = buckets([
      answerChunk({ id: 'historical-0', sourceEventId: 'source-0', seq: 0, delta: '完整' }),
      answerChunk({ id: 'historical-1', sourceEventId: 'source-1', seq: 1, delta: '答' }),
    ]);
    const liveTail = buckets([
      answerChunk({ id: 'live-overlap-1', sourceEventId: 'source-1', seq: 1, delta: '答' }),
      answerChunk({ id: 'live-2', sourceEventId: 'source-2', seq: 2, delta: '案', isLast: true }),
      terminalAnswer(),
    ]);

    const accumulator = createSubrunTraceAccumulator();
    accumulator.admitLive(liveTail);
    accumulator.admitHistorical(historicalPrefix);
    const merged = accumulator.read();
    const mergedEvents = merged?.['subrun-1']?.events ?? [];
    expect(mergedEvents.map(event => event.id)).toEqual([
      'historical-0',
      'live-overlap-1',
      'live-2',
      'trace-terminal',
    ]);

    const realtimeMessages = project(mergedEvents);
    const reloadedMessages = project(mergedEvents.map(event => ({ ...event })));

    expect(realtimeMessages).toHaveLength(1);
    expect(realtimeMessages[0]).toMatchObject({
      type: 'final_answer',
      content: '完整答案',
      metadata: {
        answer_id: 'answer-1',
        seal_source_event_id: 'source-terminal',
        completion_reason: 'terminal',
        is_complete: true,
      },
    });
    expect(reloadedMessages).toEqual(realtimeMessages);
  });
});
