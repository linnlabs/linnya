import type { SSESubRunTraceEvent } from '@linnlabs/linnkit/contracts';
import type { SubrunTraceBucketMap } from '../definitions/subrunTrace';
import { readSubrunTraceBuckets } from './hasSubrunTraceBucket';
import { isHistoricalFinalAnswerSnapshotChunk } from './projectHistoricalSubrunTraceEvent';

interface MutableSubrunTraceBucket {
  readonly subrun_id: string;
  readonly events: SSESubRunTraceEvent[];
}

interface SubrunTraceBucketState {
  bucket: MutableSubrunTraceBucket;
  readonly indexByProjectionIdentity: Map<string, number>;
  historicalEvents: readonly SSESubRunTraceEvent[];
  liveSourceEvents: readonly SSESubRunTraceEvent[] | null;
  liveProcessedLength: number;
  liveProcessedSourceEventIds: string[];
  readonly liveEventBySourceEventId: Map<string, SSESubRunTraceEvent>;
  readonly liveSourceEventOrder: string[];
}

export interface SubrunTraceAccumulator {
  admitHistorical(raw: unknown): boolean;
  admitLive(raw: unknown): boolean;
  read(): SubrunTraceBucketMap | null;
  reset(): void;
}

function sameEvents(
  left: readonly SSESubRunTraceEvent[],
  right: readonly SSESubRunTraceEvent[],
): boolean {
  return left.length === right.length && left.every((event, index) => event === right[index]);
}

function mergeHistoricalAndLiveEvents(
  historicalEvents: readonly SSESubRunTraceEvent[],
  liveSourceEventOrder: readonly string[],
  liveEventBySourceEventId: ReadonlyMap<string, SSESubRunTraceEvent>,
): SSESubRunTraceEvent[] {
  const merged: SSESubRunTraceEvent[] = [];
  const admitted = new Set<string>();

  // live snapshot 拥有当前执行期内的完整顺序。历史只补充 live 未覆盖的旧语义项，
  // 否则紧凑历史迟到时会把 complete/terminal 错排到对应 delta/chunk 之前。
  for (const historicalEvent of historicalEvents) {
    const projectionIdentity = readTraceProjectionIdentity(historicalEvent);
    if (
      liveEventBySourceEventId.has(historicalEvent.source_event_id)
      || admitted.has(projectionIdentity)
    ) {
      continue;
    }
    admitted.add(projectionIdentity);
    merged.push(historicalEvent);
  }
  for (const sourceEventId of liveSourceEventOrder) {
    if (admitted.has(sourceEventId)) continue;
    const liveEvent = liveEventBySourceEventId.get(sourceEventId);
    if (!liveEvent) continue;
    admitted.add(sourceEventId);
    merged.push(liveEvent);
  }

  return merged;
}

function readTraceProjectionIdentity(event: SSESubRunTraceEvent): string {
  return isHistoricalFinalAnswerSnapshotChunk(event)
    ? `${event.source_event_id}\u0000historical-final-answer-snapshot-chunk`
    : event.source_event_id;
}

/**
 * historical prefix 与 live tail 的稳定 read model。
 *
 * historical 迟到时只允许发生一次有业务含义的前缀重排；之后同一 live events
 * 引用只扫描尚未接纳的尾部，避免每个 version 都重新合并完整数组。
 */
export function createSubrunTraceAccumulator(): SubrunTraceAccumulator {
  const buckets: Record<string, MutableSubrunTraceBucket> = {};
  const states = new Map<string, SubrunTraceBucketState>();
  let historicalSource: unknown = null;

  const ensureState = (subrunId: string): SubrunTraceBucketState => {
    const existing = states.get(subrunId);
    if (existing) return existing;

    const bucket: MutableSubrunTraceBucket = { subrun_id: subrunId, events: [] };
    const created: SubrunTraceBucketState = {
      bucket,
      indexByProjectionIdentity: new Map(),
      historicalEvents: [],
      liveSourceEvents: null,
      liveProcessedLength: 0,
      liveProcessedSourceEventIds: [],
      liveEventBySourceEventId: new Map(),
      liveSourceEventOrder: [],
    };
    states.set(subrunId, created);
    buckets[subrunId] = bucket;
    return created;
  };

  const replaceBucketEvents = (
    state: SubrunTraceBucketState,
    events: SSESubRunTraceEvent[],
  ): void => {
    state.bucket = { subrun_id: state.bucket.subrun_id, events };
    buckets[state.bucket.subrun_id] = state.bucket;
    state.indexByProjectionIdentity.clear();
    events.forEach((event, index) => {
      state.indexByProjectionIdentity.set(readTraceProjectionIdentity(event), index);
    });
  };

  const rebuildBucketFromSources = (state: SubrunTraceBucketState): void => {
    replaceBucketEvents(
      state,
      mergeHistoricalAndLiveEvents(
        state.historicalEvents,
        state.liveSourceEventOrder,
        state.liveEventBySourceEventId,
      ),
    );
  };

  const resetLiveSource = (
    state: SubrunTraceBucketState,
    liveEvents: readonly SSESubRunTraceEvent[],
  ): void => {
    state.liveEventBySourceEventId.clear();
    state.liveSourceEventOrder.splice(0);

    for (const event of liveEvents) {
      if (!state.liveEventBySourceEventId.has(event.source_event_id)) {
        state.liveSourceEventOrder.push(event.source_event_id);
      }
      state.liveEventBySourceEventId.set(event.source_event_id, event);
    }

    state.liveSourceEvents = liveEvents;
    state.liveProcessedLength = liveEvents.length;
    state.liveProcessedSourceEventIds = liveEvents.map(event => event.source_event_id);
    // source epoch 改变意味着旧 live tail 已失效；必须替换 bucket identity 明确重放。
    rebuildBucketFromSources(state);
  };

  return {
    admitHistorical(raw: unknown): boolean {
      if (raw === historicalSource) return false;
      historicalSource = raw;
      const historicalBuckets = readSubrunTraceBuckets(raw);
      let changed = false;

      for (const [subrunId, historicalBucket] of Object.entries(historicalBuckets)) {
        const state = ensureState(subrunId);
        state.historicalEvents = historicalBucket.events;
        const merged = mergeHistoricalAndLiveEvents(
          historicalBucket.events,
          state.liveSourceEventOrder,
          state.liveEventBySourceEventId,
        );

        if (!sameEvents(state.bucket.events, merged)) {
          // 前缀重排会改变既有索引，因此替换 bucket identity，让下游明确重建一次。
          replaceBucketEvents(state, merged);
          changed = true;
        }
      }

      return changed;
    },

    admitLive(raw: unknown): boolean {
      const liveBuckets = readSubrunTraceBuckets(raw);
      let changed = false;

      for (const [subrunId, liveBucket] of Object.entries(liveBuckets)) {
        const state = ensureState(subrunId);
        const sameLiveSource = state.liveSourceEvents === liveBucket.events;
        const replacedSourceEventIds = sameLiveSource
          ? null
          : liveBucket.events.map(event => event.source_event_id);
        const continuesPreviousSource = sameLiveSource
          ? state.liveProcessedLength <= liveBucket.events.length
          : state.liveProcessedSourceEventIds.length <= (replacedSourceEventIds?.length ?? 0)
            && state.liveProcessedSourceEventIds.every(
              (sourceEventId, index) => replacedSourceEventIds?.[index] === sourceEventId,
            );

        if (!continuesPreviousSource) {
          resetLiveSource(state, liveBucket.events);
          changed = true;
          continue;
        }

        const startIndex = sameLiveSource ? state.liveProcessedLength : 0;
        const replacements = new Map<number, SSESubRunTraceEvent>();
        const additions: SSESubRunTraceEvent[] = [];

        for (let index = startIndex; index < liveBucket.events.length; index += 1) {
          const event = liveBucket.events[index];
          if (!event) continue;

          if (!state.liveEventBySourceEventId.has(event.source_event_id)) {
            state.liveSourceEventOrder.push(event.source_event_id);
          }
          state.liveEventBySourceEventId.set(event.source_event_id, event);

          const admittedIndex = state.indexByProjectionIdentity.get(
            readTraceProjectionIdentity(event),
          );
          if (admittedIndex === undefined) {
            state.indexByProjectionIdentity.set(
              readTraceProjectionIdentity(event),
              state.bucket.events.length + additions.length,
            );
            additions.push(event);
          } else if (state.bucket.events[admittedIndex] !== event) {
            replacements.set(admittedIndex, event);
          }
        }

        state.liveSourceEvents = liveBucket.events;
        state.liveProcessedLength = liveBucket.events.length;
        state.liveProcessedSourceEventIds = sameLiveSource
          ? [
              ...state.liveProcessedSourceEventIds,
              ...liveBucket.events.slice(startIndex).map(event => event.source_event_id),
            ]
          : replacedSourceEventIds ?? [];

        if (replacements.size > 0) {
          const replacesHistoricalOrder = [...replacements.keys()].some(
            index => state.historicalEvents.some(
              event => event.source_event_id === state.bucket.events[index]?.source_event_id,
            ),
          );
          if (replacesHistoricalOrder) {
            rebuildBucketFromSources(state);
            changed = true;
            continue;
          }
          const nextEvents = [...state.bucket.events];
          for (const [index, event] of replacements) nextEvents[index] = event;
          nextEvents.push(...additions);
          // historical DTO 被 live DTO 替换时，既有投影也必须从明确的新 bucket 重放。
          replaceBucketEvents(state, nextEvents);
          changed = true;
          continue;
        }

        if (additions.length > 0) {
          state.bucket.events.push(...additions);
          changed = true;
        }
      }

      return changed;
    },

    read(): SubrunTraceBucketMap | null {
      return states.size > 0 ? buckets : null;
    },

    reset(): void {
      for (const key of Object.keys(buckets)) delete buckets[key];
      states.clear();
      historicalSource = null;
    },
  };
}
