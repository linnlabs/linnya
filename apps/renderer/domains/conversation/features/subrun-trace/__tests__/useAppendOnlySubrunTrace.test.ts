import { effectScope, nextTick, ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import type { SSESubRunTraceEvent } from '@linnlabs/linnkit/contracts';
import { ToolCallIdSchema } from '@linnlabs/linnkit/contracts';

import type { SubrunTraceBucketMap } from '../definitions/subrunTrace';
import { useAppendOnlySubrunTrace } from '../orchestration/useAppendOnlySubrunTrace';
import { ToolCompactStepProjectionError } from '../../../ports/toolCompactStepProjectionPort';

function traceEvent(id: string): SSESubRunTraceEvent {
  return {
    type: 'subrun_trace',
    id,
    conversation_id: 'conv-1',
    turn_id: 'turn-1',
    timestamp: 1,
    parent_tool_call_id: ToolCallIdSchema.parse('parent-1'),
    subrun_id: 'subrun-1',
    source_event_id: `source-${id}`,
    kind: 'thought_delta',
    delta: id,
  };
}

function buckets(events: readonly SSESubRunTraceEvent[]): SubrunTraceBucketMap {
  return { 'subrun-1': { subrun_id: 'subrun-1', events } };
}

async function flushAdmission(): Promise<void> {
  await nextTick();
  await Promise.resolve();
}

describe('useAppendOnlySubrunTrace', () => {
  it('初始 bucket 在 reactive flush 之后完整接纳', async () => {
    const source = ref<SubrunTraceBucketMap>(buckets([traceEvent('event-1')]));
    const projected: string[] = [];
    const scope = effectScope();
    scope.run(() => useAppendOnlySubrunTrace({
      subrunTrace: () => source.value,
      version: () => 0,
      subrunId: () => 'subrun-1',
      onReset: () => projected.splice(0),
      onEvents: events => projected.push(...events.map(item => item.event.id)),
    }));

    expect(projected).toEqual([]);
    await flushAdmission();
    expect(projected).toEqual(['event-1']);
    scope.stop();
  });

  it('bucket 替换时重建，同一 bucket 追加时只接纳新增事件', async () => {
    const source = ref<SubrunTraceBucketMap>(buckets([traceEvent('event-1')]));
    const version = ref(1);
    const projected: string[] = [];
    let resetCount = 0;
    const scope = effectScope();
    scope.run(() => useAppendOnlySubrunTrace({
      subrunTrace: () => source.value,
      version: () => version.value,
      subrunId: () => 'subrun-1',
      onReset: () => {
        resetCount += 1;
        projected.splice(0);
      },
      onEvents: events => projected.push(...events.map(item => item.event.id)),
    }));
    await flushAdmission();

    source.value = buckets([traceEvent('event-1'), traceEvent('event-2')]);
    await flushAdmission();
    expect(projected).toEqual(['event-1', 'event-2']);
    expect(resetCount).toBe(2);

    const currentBucket = source.value['subrun-1'];
    if (!currentBucket) throw new Error('expected bucket');
    const mutableEvents = [...currentBucket.events];
    source.value = { 'subrun-1': { ...currentBucket, events: mutableEvents } };
    await flushAdmission();
    mutableEvents.push(traceEvent('event-3'));
    version.value += 1;
    await flushAdmission();

    expect(projected).toEqual(['event-1', 'event-2', 'event-3']);
    expect(resetCount).toBe(3);
    scope.stop();
  });

  it('admission 错误不会从 Vue watch 抛出，且 processedLength 不前移', async () => {
    const source = ref<SubrunTraceBucketMap>(buckets([traceEvent('event-1')]));
    const version = ref(1);
    const onAdmissionError = vi.fn();
    const admitted: string[] = [];
    let shouldFail = true;
    const scope = effectScope();
    scope.run(() => useAppendOnlySubrunTrace({
      subrunTrace: () => source.value,
      version: () => version.value,
      subrunId: () => 'subrun-1',
      onReset: () => admitted.splice(0),
      onEvents: events => {
        if (shouldFail) throw new Error('projection failed');
        admitted.push(...events.map(item => item.event.id));
      },
      onAdmissionError,
    }));

    await expect(flushAdmission()).resolves.toBeUndefined();
    expect(onAdmissionError).toHaveBeenCalledOnce();
    expect(admitted).toEqual([]);

    shouldFail = false;
    version.value += 1;
    await flushAdmission();
    expect(admitted).toEqual(['event-1']);
    scope.stop();
  });

  it('同一 bucket/version/toolCall/projector 的失败诊断只上报一次', async () => {
    const source = ref<SubrunTraceBucketMap>(buckets([traceEvent('event-1')]));
    const onAdmissionError = vi.fn();
    const scope = effectScope();
    scope.run(() => useAppendOnlySubrunTrace({
      subrunTrace: () => source.value,
      version: () => 7,
      subrunId: () => 'subrun-1',
      onReset: () => undefined,
      onEvents: () => {
        throw new ToolCompactStepProjectionError({
          sourceToolName: 'knowledge_search',
          uiKey: 'knowledge_search',
          toolCallId: 'knowledge-call-error',
          status: 'error',
          phase: 'error',
        }, new Error('invalid compact payload'));
      },
      onAdmissionError,
    }));
    await flushAdmission();

    source.value = buckets([traceEvent('event-1')]);
    await flushAdmission();

    expect(onAdmissionError).toHaveBeenCalledOnce();
    expect(onAdmissionError).toHaveBeenCalledWith(expect.objectContaining({
      bucketId: 'subrun-1',
      traceVersion: 7,
      fingerprint: 'subrun-1|7|knowledge-call-error|knowledge_search',
      projection: {
        sourceToolName: 'knowledge_search',
        uiKey: 'knowledge_search',
        toolCallId: 'knowledge-call-error',
      },
    }));
    scope.stop();
  });
});
