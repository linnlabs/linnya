import type { RuntimeEvent, SerializableJsonRecord } from '@linnlabs/linnkit/contracts';

/**
 * Graph 原生控制事件不会经过 AgentEvent mapper，这里统一补齐 host 扩展元数据。
 * 原事件 metadata 优先保留；正式路由身份由 lifecycle coordinator 写入顶层字段。
 */
export function withRuntimeEventMetadata<TEvent extends RuntimeEvent>(
  event: TEvent,
  lifecycleMetadata: SerializableJsonRecord | undefined,
): TEvent {
  if (!lifecycleMetadata) return event;
  return Object.assign({}, event, {
    metadata: {
      ...(event.metadata ?? {}),
      ...lifecycleMetadata,
    },
  });
}
