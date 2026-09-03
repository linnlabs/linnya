import type {
  LoadedSubrunTrace,
  LoadSubrunTraceResult,
  ReadSubrunTraceOptions,
  SubrunTraceApiPort,
  SubrunTraceBucketMap,
} from '../definitions/subrunTrace';
import { buildSubrunTraceBuckets } from '../functions/buildSubrunTraceBuckets';

export interface LoadSubrunTraceDeps {
  readonly api?: SubrunTraceApiPort;
}

export async function loadSubrunTrace(
  conversationId: string,
  parentToolCallId: string,
  options: ReadSubrunTraceOptions,
  deps: LoadSubrunTraceDeps = {},
): Promise<LoadSubrunTraceResult> {
  const api = deps.api ?? await loadDefaultSubrunTraceApi();
  const dto = await api.readSubrunTrace(conversationId, parentToolCallId, options);
  if (dto.success === false) {
    return { status: 'preparing' };
  }

  return {
    status: 'ready',
    buckets: buildSubrunTraceBuckets(dto.events, { origin: 'historical' }),
    eventCount: dto.events.length,
    nextCursor: dto.next_cursor,
    revision: dto.revision,
  };
}

/**
 * 按服务端游标读完父工具下的全部 trace。
 *
 * UI 展开语义是“查看该 subrun 的完整历史”，不能在首个 2000-event page
 * 后静默标记 ready；分页循环属于加载编排，不应泄漏给 SubrunCard。
 */
export async function loadCompleteSubrunTrace(
  conversationId: string,
  parentToolCallId: string,
  options: ReadSubrunTraceOptions,
  deps: LoadSubrunTraceDeps = {},
): Promise<LoadSubrunTraceResult> {
  const buckets: Record<string, SubrunTraceBucketMap[string]> = {};
  let eventCount = 0;
  let cursor = options.cursor;
  let revision = 0;

  while (true) {
    const page = await loadSubrunTrace(conversationId, parentToolCallId, {
      ...options,
      ...(cursor === undefined ? {} : { cursor }),
    }, deps);
    if (page.status === 'preparing') return page;

    for (const [subrunId, bucket] of Object.entries(page.buckets)) {
      const previous = buckets[subrunId];
      buckets[subrunId] = {
        subrun_id: subrunId,
        events: [...(previous?.events ?? []), ...bucket.events],
      };
    }
    eventCount += page.eventCount;
    revision = page.revision;

    if (page.nextCursor === null) {
      const completed: LoadedSubrunTrace = {
        status: 'ready',
        buckets,
        eventCount,
        nextCursor: null,
        revision,
      };
      return completed;
    }
    cursor = page.nextCursor;
  }
}

async function loadDefaultSubrunTraceApi(): Promise<SubrunTraceApiPort> {
  const module = await import('./subrunTraceApi');
  return module.subrunTraceApi;
}
