import { describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, ref } from 'vue';
import type { RuntimeEvent, SubRunTraceEvent } from '@linnlabs/linnkit/contracts';
import {
  SUBRUN_TRACE_STEP_KINDS,
  SUBRUN_TRACE_SUBRUN_CARD_KINDS,
} from '../definitions/subrunTrace';
import type {
  HistoricalSubrunTraceLazySource,
  LoadedSubrunTrace,
  SubrunTraceApiPort,
  SubrunTraceHistoryCachePort,
} from '../definitions/subrunTrace';
import { buildSubrunTraceBuckets } from '../functions/buildSubrunTraceBuckets';
import { createSubrunTraceAccumulator } from '../functions/createSubrunTraceAccumulator';
import { findSubrunTraceBucket } from '../functions/hasSubrunTraceBucket';
import { isHistoricalFinalAnswerSnapshotChunk } from '../functions/projectHistoricalSubrunTraceEvent';
import { loadCompleteSubrunTrace, loadSubrunTrace } from '../orchestration/loadSubrunTrace';
import { useLazySubrunTrace } from '../orchestration/useLazySubrunTrace';
import { ToolCallIdSchema } from '@linnlabs/linnkit/contracts';

function createSubrunEvent(overrides: Partial<SubRunTraceEvent> = {}): SubRunTraceEvent {
  return {
    type: 'subrun_trace',
    id: 'trace-1',
    conversation_id: 'conv-1',
    turn_id: 'turn-1',
    timestamp: 100,
    version: 1,
    ephemeral: true,
    parent_tool_call_id: ToolCallIdSchema.parse('parent-call'),
    subrun_id: 'subrun-a',
    source_event_id: 'source-trace-1',
    kind: 'tool_process',
    tool_name: 'search',
    tool_call_id: ToolCallIdSchema.parse('call-1'),
    status: 'loading',
    phase: 'start',
    args: { query: 'hello' },
    ...overrides,
  };
}

describe('subrun-trace historical loader', () => {
  it('SubrunCard 历史查询包含流式思考与流式最终答案', () => {
    expect(SUBRUN_TRACE_SUBRUN_CARD_KINDS).toContain('thought_delta');
    expect(SUBRUN_TRACE_SUBRUN_CARD_KINDS).toContain('final_answer_chunk');
  });

  it('maps RuntimeEvent rows to SSE buckets grouped by subrun_id', () => {
    const buckets = buildSubrunTraceBuckets([
      createSubrunEvent({ id: 'trace-1', subrun_id: 'subrun-a', kind: 'tool_process' }),
      createSubrunEvent({
        id: 'trace-2',
        subrun_id: 'subrun-b',
        kind: 'tool_output',
        status: 'success',
      }),
      { ...createSubrunEvent({ id: 'trace-ignored' }), type: 'control', op: 'truncate_after' },
    ]);

    expect(Object.keys(buckets)).toEqual(['subrun-a', 'subrun-b']);
    expect(buckets['subrun-a']?.events[0]?.type).toBe('subrun_trace');
    expect(buckets['subrun-a']?.events[0]?.kind).toBe('tool_process');
    expect(buckets['subrun-b']?.events[0]?.kind).toBe('tool_output');
  });

  it('selects the requested bucket from parallel subruns', () => {
    const buckets = buildSubrunTraceBuckets([
      createSubrunEvent({ id: 'trace-a', subrun_id: 'subrun-a' }),
      createSubrunEvent({ id: 'trace-b', subrun_id: 'subrun-b' }),
    ]);

    expect(findSubrunTraceBucket(buckets, 'subrun-b')?.events[0]?.id).toBe('trace-b');
    expect(findSubrunTraceBucket(buckets, 'subrun-missing')).toBeNull();
  });

  it('按 source_event_id 合并历史前缀与 live 尾部，重叠事实使用 live DTO 且顺序稳定', () => {
    const historical = buildSubrunTraceBuckets([
      createSubrunEvent({ id: 'historical-a', source_event_id: 'source-a' }),
      createSubrunEvent({ id: 'historical-b', source_event_id: 'source-b' }),
      createSubrunEvent({
        id: 'historical-other',
        source_event_id: 'source-other',
        subrun_id: 'subrun-b',
      }),
    ]);
    const live = buildSubrunTraceBuckets([
      createSubrunEvent({ id: 'live-b', source_event_id: 'source-b' }),
      createSubrunEvent({ id: 'live-c', source_event_id: 'source-c' }),
    ]);

    const accumulator = createSubrunTraceAccumulator();
    accumulator.admitHistorical(historical);
    accumulator.admitLive(live);
    const merged = accumulator.read();

    expect(merged?.['subrun-a']?.events.map(event => event.id)).toEqual([
      'historical-a',
      'live-b',
      'live-c',
    ]);
    expect(merged?.['subrun-b']?.events.map(event => event.id)).toEqual(['historical-other']);
  });

  it('紧凑历史迟到时保持 live 内 delta 到 complete 的事实顺序', () => {
    const live = buildSubrunTraceBuckets([
      createSubrunEvent({
        id: 'live-thought-delta',
        source_event_id: 'source-thought-delta',
        kind: 'thought_delta',
        content: '正在分析',
      }),
      createSubrunEvent({
        id: 'live-thought-complete',
        source_event_id: 'source-thought-complete',
        kind: 'thought_complete',
        content: '分析完成',
      }),
    ]);
    const compactHistory = buildSubrunTraceBuckets([
      createSubrunEvent({
        id: 'historical-old-tool-output',
        source_event_id: 'source-old-tool-output',
        kind: 'tool_output',
        status: 'success',
      }),
      createSubrunEvent({
        id: 'historical-thought-complete',
        source_event_id: 'source-thought-complete',
        kind: 'thought_complete',
        content: '分析完成',
      }),
    ]);
    const accumulator = createSubrunTraceAccumulator();
    accumulator.admitLive(live);
    accumulator.admitHistorical(compactHistory);

    expect(accumulator.read()?.['subrun-a']?.events.map(event => event.id)).toEqual([
      'historical-old-tool-output',
      'live-thought-delta',
      'live-thought-complete',
    ]);
  });

  it('同一 live 数组缩短时只重建对应 subrun，并保留 historical prefix', () => {
    const historical = buildSubrunTraceBuckets([
      createSubrunEvent({ id: 'historical-a', source_event_id: 'source-a' }),
      createSubrunEvent({
        id: 'historical-other',
        source_event_id: 'source-other',
        subrun_id: 'subrun-b',
      }),
    ]);
    const initialLive = buildSubrunTraceBuckets([
      createSubrunEvent({ id: 'live-b', source_event_id: 'source-b' }),
      createSubrunEvent({ id: 'live-c', source_event_id: 'source-c' }),
    ]);
    const liveEvents = [...(initialLive['subrun-a']?.events ?? [])];
    const live = {
      'subrun-a': { subrun_id: 'subrun-a', events: liveEvents },
    };
    const accumulator = createSubrunTraceAccumulator();

    accumulator.admitHistorical(historical);
    accumulator.admitLive(live);
    const previousSubrunA = accumulator.read()?.['subrun-a'];
    const previousSubrunB = accumulator.read()?.['subrun-b'];
    liveEvents.splice(1);

    expect(accumulator.admitLive(live)).toBe(true);
    expect(accumulator.read()?.['subrun-a']).not.toBe(previousSubrunA);
    expect(accumulator.read()?.['subrun-a']?.events.map(event => event.id)).toEqual([
      'historical-a',
      'live-b',
    ]);
    expect(accumulator.read()?.['subrun-b']).toBe(previousSubrunB);
  });

  it.each([
    {
      name: '更短的新 snapshot',
      replacement: [createSubrunEvent({ id: 'live-b-next', source_event_id: 'source-b' })],
      expected: ['historical-a', 'live-b-next'],
    },
    {
      name: '非前缀的新 snapshot',
      replacement: [
        createSubrunEvent({ id: 'live-x', source_event_id: 'source-x' }),
        createSubrunEvent({ id: 'live-y', source_event_id: 'source-y' }),
      ],
      expected: ['historical-a', 'live-x', 'live-y'],
    },
  ])('$name 会丢弃旧 live tail 并从新 source epoch 重建', ({ replacement, expected }) => {
    const accumulator = createSubrunTraceAccumulator();
    accumulator.admitHistorical(
      buildSubrunTraceBuckets([
        createSubrunEvent({ id: 'historical-a', source_event_id: 'source-a' }),
      ])
    );
    accumulator.admitLive(
      buildSubrunTraceBuckets([
        createSubrunEvent({ id: 'live-b', source_event_id: 'source-b' }),
        createSubrunEvent({ id: 'live-c', source_event_id: 'source-c' }),
      ])
    );

    const previousBucket = accumulator.read()?.['subrun-a'];
    expect(accumulator.admitLive(buildSubrunTraceBuckets(replacement))).toBe(true);
    expect(accumulator.read()?.['subrun-a']).not.toBe(previousBucket);
    expect(accumulator.read()?.['subrun-a']?.events.map(event => event.id)).toEqual(expected);
  });

  it('loads filtered historical trace through the API port', async () => {
    const calls: Array<{ kinds: readonly string[]; limit?: number; cursor?: number }> = [];
    const api: SubrunTraceApiPort = {
      async readSubrunTrace(_conversationId, _parentToolCallId, options) {
        calls.push({ kinds: options.kinds, limit: options.limit, cursor: options.cursor });
        const events = options.kinds.includes('final_answer')
          ? [
              createSubrunEvent({
                id: 'trace-final-answer',
                kind: 'final_answer',
                answer_id: 'answer-history',
                content: '历史子任务最终回答',
                completion_reason: 'terminal',
                status: 'success',
              }),
            ]
          : [];
        return {
          success: true,
          conversation_id: 'conv-1',
          parent_tool_call_id: 'parent-call',
          subrun_id: options.subrunId,
          events,
          next_cursor: 123,
          revision: 9,
        };
      },
    };

    const result = await loadSubrunTrace(
      'conv-1',
      'parent-call',
      {
        subrunId: 'subrun-a',
        kinds: SUBRUN_TRACE_SUBRUN_CARD_KINDS,
        limit: 2000,
      },
      { api }
    );

    expect(calls).toEqual([
      { kinds: SUBRUN_TRACE_SUBRUN_CARD_KINDS, limit: 2000, cursor: undefined },
    ]);
    expect(result.status).toBe('ready');
    expect(result.status === 'ready' ? result.eventCount : 0).toBe(1);
    expect(result.status === 'ready' ? result.nextCursor : null).toBe(123);
    expect(result.status === 'ready' ? Object.keys(result.buckets) : []).toEqual(['subrun-a']);
    const projectedEvents = result.status === 'ready'
      ? result.buckets['subrun-a']?.events ?? []
      : [];
    expect(projectedEvents.map(event => event.kind)).toEqual([
      'final_answer_chunk',
      'final_answer',
    ]);
    expect(projectedEvents[0]).toMatchObject({
      answer_id: 'answer-history',
      source_event_id: 'source-trace-1',
      seq: 0,
      delta: '历史子任务最终回答',
      is_last: true,
    });
    expect(projectedEvents[1]?.source_event_id).toBe('source-trace-1');
    expect(projectedEvents[0] && isHistoricalFinalAnswerSnapshotChunk(projectedEvents[0])).toBe(
      true,
    );
  });

  it('follows every cursor page before exposing a complete historical trace', async () => {
    const cursors: Array<number | undefined> = [];
    const api: SubrunTraceApiPort = {
      async readSubrunTrace(_conversationId, _parentToolCallId, options) {
        cursors.push(options.cursor);
        const firstPage = options.cursor === undefined;
        return {
          success: true,
          conversation_id: 'conv-1',
          parent_tool_call_id: 'parent-call',
          subrun_id: options.subrunId,
          events: firstPage
            ? [
                createSubrunEvent({ id: 'trace-a-process', subrun_id: 'subrun-a' }),
              ]
            : [
                createSubrunEvent({
                  id: 'trace-a-final',
                  subrun_id: 'subrun-a',
                  kind: 'final_answer',
                  answer_id: 'answer-a',
                  content: '完整历史回答',
                  completion_reason: 'terminal',
                }),
              ],
          next_cursor: firstPage ? 20 : null,
          revision: 9,
        };
      },
    };

    const result = await loadCompleteSubrunTrace(
      'conv-1',
      'parent-call',
      {
        subrunId: 'subrun-a',
        kinds: SUBRUN_TRACE_SUBRUN_CARD_KINDS,
        limit: 2,
      },
      { api }
    );

    expect(cursors).toEqual([undefined, 20]);
    expect(result.status).toBe('ready');
    expect(result.status === 'ready' ? result.eventCount : 0).toBe(2);
    expect(result.status === 'ready' ? Object.keys(result.buckets) : []).toEqual(['subrun-a']);
    expect(
      result.status === 'ready' ? result.buckets['subrun-a']?.events.map(event => event.id) : []
    ).toEqual([
      'trace-a-process',
      'trace-a-final:snapshot-chunk',
      'trace-a-final',
    ]);
  });

  it('keeps historical trace lazy until the caller expands the UI', async () => {
    const calls: string[] = [];
    const source = ref({
      conversationId: 'conv-1',
      parentToolCallId: 'parent-call',
      subrunId: 'subrun-a',
      kinds: SUBRUN_TRACE_STEP_KINDS,
    });
    const scope = effectScope();
    const lazyTrace = scope.run(() =>
      useLazySubrunTrace(
        () => source.value,
        async (conversationId, parentToolCallId) => {
          calls.push(`${conversationId}:${parentToolCallId}`);
          return {
            status: 'ready',
            buckets: buildSubrunTraceBuckets([createSubrunEvent({ id: 'trace-lazy' })]),
            eventCount: 1,
            nextCursor: null,
            revision: 1,
          };
        }
      )
    );
    if (!lazyTrace) {
      throw new Error('expected lazy trace composable to initialize');
    }

    expect(calls).toEqual([]);
    await lazyTrace.load();

    expect(calls).toEqual(['conv-1:parent-call']);
    expect(lazyTrace.status.value).toBe('ready');
    expect(Object.keys(lazyTrace.buckets.value ?? {})).toEqual(['subrun-a']);
    scope.stop();
  });

  it('跨 surface 复用 exact source 的完整历史快照，不重复请求或改变首帧高度', async () => {
    const entries = new Map<string, {
      readonly invalidationRevision: number;
      readonly trace: LoadedSubrunTrace;
    }>();
    const cache: SubrunTraceHistoryCachePort = {
      read(sourceKey, invalidationRevision) {
        const entry = entries.get(sourceKey);
        return entry?.invalidationRevision === invalidationRevision ? entry.trace : null;
      },
      write(sourceKey, invalidationRevision, trace) {
        entries.set(sourceKey, { invalidationRevision, trace });
      },
    };
    const source = () => ({
      conversationId: 'conv-cache',
      parentToolCallId: 'parent-cache',
      subrunId: 'subrun-cache',
      kinds: SUBRUN_TRACE_STEP_KINDS,
    });
    let callCount = 0;
    const load = async (): Promise<LoadedSubrunTrace> => {
      callCount += 1;
      return {
        status: 'ready',
        buckets: buildSubrunTraceBuckets([
          createSubrunEvent({ id: 'trace-cache', subrun_id: 'subrun-cache' }),
        ]),
        eventCount: 1,
        nextCursor: null,
        revision: 1,
      };
    };

    const firstScope = effectScope();
    const first = firstScope.run(() => useLazySubrunTrace(source, load, () => 0, cache));
    if (!first) throw new Error('expected first cached trace composable');
    await first.load();
    firstScope.stop();

    const secondScope = effectScope();
    const second = secondScope.run(() => useLazySubrunTrace(source, load, () => 0, cache));
    if (!second) throw new Error('expected second cached trace composable');
    expect(second.status.value).toBe('ready');
    expect(second.buckets.value?.['subrun-cache']?.events).toHaveLength(1);
    await second.load();
    expect(callCount).toBe(1);
    secondScope.stop();
  });

  it('用户先展开时保留读取意图，首条 trace 补齐 child 身份后才发 detail 请求', async () => {
    const source = ref<HistoricalSubrunTraceLazySource>({
      conversationId: 'conv-1',
      parentToolCallId: 'parent-call',
      kinds: SUBRUN_TRACE_STEP_KINDS,
    });
    const requestedSubrunIds: string[] = [];
    const scope = effectScope();
    const lazyTrace = scope.run(() => useLazySubrunTrace(
      () => source.value,
      async (_conversationId, _parentToolCallId, options) => {
        requestedSubrunIds.push(options.subrunId);
        return {
          status: 'ready',
          buckets: buildSubrunTraceBuckets([
            createSubrunEvent({ id: 'trace-after-identity', subrun_id: options.subrunId }),
          ]),
          eventCount: 1,
          nextCursor: null,
          revision: 1,
        };
      },
    ));
    if (!lazyTrace) throw new Error('expected lazy trace composable to initialize');

    await lazyTrace.load();
    expect(requestedSubrunIds).toEqual([]);
    expect(lazyTrace.status.value).toBe('idle');

    source.value = { ...source.value, subrunId: 'subrun-after-expand' };
    await vi.waitFor(() => expect(lazyTrace.status.value).toBe('ready'));

    expect(requestedSubrunIds).toEqual(['subrun-after-expand']);
    expect(lazyTrace.buckets.value?.['subrun-after-expand']?.events).toHaveLength(1);
    scope.stop();
  });

  it('durable invalidation 只重读已经展开过的 trace，并接纳取消后的终态事实', async () => {
    const refreshVersion = ref(0);
    let callCount = 0;
    let releaseReload: (() => void) | undefined;
    const reloadBarrier = new Promise<void>(resolve => {
      releaseReload = resolve;
    });
    const scope = effectScope();
    const lazyTrace = scope.run(() =>
      useLazySubrunTrace(
        () => ({
          conversationId: 'conv-1',
          parentToolCallId: 'parent-call',
          subrunId: 'subrun-a',
          kinds: SUBRUN_TRACE_STEP_KINDS,
        }),
        async () => {
          callCount += 1;
          if (callCount > 1) await reloadBarrier;
          const events: SubRunTraceEvent[] = [
            createSubrunEvent({
              id: 'trace-start',
              source_event_id: 'source-start',
              kind: 'tool_process',
              status: 'loading',
            }),
          ];
          if (callCount > 1) {
            events.push(
              createSubrunEvent({
                id: 'trace-output',
                source_event_id: 'source-output',
                kind: 'tool_output',
                status: 'error',
                output: JSON.stringify({ error: 'cancelled during execution' }),
              })
            );
          }
          return {
            status: 'ready',
            buckets: buildSubrunTraceBuckets(events),
            eventCount: events.length,
            nextCursor: null,
            revision: callCount,
          };
        },
        () => refreshVersion.value
      )
    );
    if (!lazyTrace) throw new Error('expected lazy trace composable to initialize');

    refreshVersion.value += 1;
    await nextTick();
    expect(callCount).toBe(0);

    await lazyTrace.load();
    expect(lazyTrace.buckets.value?.['subrun-a']?.events).toHaveLength(1);

    refreshVersion.value += 1;
    await vi.waitFor(() => expect(callCount).toBe(2));
    expect(lazyTrace.status.value).toBe('loading');
    expect(lazyTrace.buckets.value?.['subrun-a']?.events).toHaveLength(1);

    if (!releaseReload) throw new Error('expected durable reload barrier to initialize');
    releaseReload();
    await vi.waitFor(() => expect(lazyTrace.status.value).toBe('ready'));

    expect(lazyTrace.buckets.value?.['subrun-a']?.events.map(event => event.kind)).toEqual([
      'tool_process',
      'tool_output',
    ]);
    scope.stop();
  });

  it('preparing 与 error 都允许下一次展开重新加载', async () => {
    let callCount = 0;
    const scope = effectScope();
    const lazyTrace = scope.run(() =>
      useLazySubrunTrace(
        () => ({
          conversationId: 'conv-1',
          parentToolCallId: 'parent-call',
          subrunId: 'subrun-a',
          kinds: SUBRUN_TRACE_STEP_KINDS,
        }),
        async () => {
          callCount += 1;
          if (callCount === 1) return { status: 'preparing' };
          if (callCount === 2) throw new Error('temporary read failure');
          return {
            status: 'ready',
            buckets: buildSubrunTraceBuckets([createSubrunEvent({ id: 'trace-retried' })]),
            eventCount: 1,
            nextCursor: null,
            revision: 2,
          };
        }
      )
    );
    if (!lazyTrace) throw new Error('expected lazy trace composable to initialize');

    await lazyTrace.load();
    expect(lazyTrace.status.value).toBe('preparing');
    await expect(lazyTrace.load()).rejects.toThrow('temporary read failure');
    expect(lazyTrace.status.value).toBe('error');
    await lazyTrace.load();

    expect(callCount).toBe(3);
    expect(lazyTrace.status.value).toBe('ready');
    scope.stop();
  });

  it('source 切换后忽略旧请求的迟到结果，并立即加载新 source', async () => {
    const source = ref({
      conversationId: 'conv-1',
      parentToolCallId: 'parent-a',
      subrunId: 'subrun-a',
      kinds: SUBRUN_TRACE_STEP_KINDS,
    });
    let resolveOldRequest:
      | ((result: Awaited<ReturnType<typeof loadCompleteSubrunTrace>>) => void)
      | undefined;
    const calls: string[] = [];
    const scope = effectScope();
    const lazyTrace = scope.run(() =>
      useLazySubrunTrace(
        () => source.value,
        async (_conversationId, parentToolCallId) => {
          calls.push(parentToolCallId);
          if (parentToolCallId === 'parent-a') {
            return await new Promise(resolve => {
              resolveOldRequest = resolve;
            });
          }
          return {
            status: 'ready',
            buckets: buildSubrunTraceBuckets([
              createSubrunEvent({ id: 'trace-new', subrun_id: 'subrun-new' }),
            ]),
            eventCount: 1,
            nextCursor: null,
            revision: 2,
          };
        }
      )
    );
    if (!lazyTrace) throw new Error('expected lazy trace composable to initialize');

    const oldLoad = lazyTrace.load();
    source.value = { ...source.value, parentToolCallId: 'parent-b' };
    await nextTick();
    await lazyTrace.load();
    resolveOldRequest?.({
      status: 'ready',
      buckets: buildSubrunTraceBuckets([
        createSubrunEvent({ id: 'trace-old', subrun_id: 'subrun-old' }),
      ]),
      eventCount: 1,
      nextCursor: null,
      revision: 1,
    });
    await oldLoad;

    expect(calls).toEqual(['parent-a', 'parent-b']);
    expect(Object.keys(lazyTrace.buckets.value ?? {})).toEqual(['subrun-new']);
    scope.stop();
  });
});
