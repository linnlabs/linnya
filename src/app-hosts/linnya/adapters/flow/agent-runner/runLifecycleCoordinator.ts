import type { ConversationNextRequest } from '@app/schemas';
import type { events, runContext } from '@linnlabs/linnkit/runtime-kernel';
import {
  toSerializableJsonRecord,
  toSerializableJsonValue,
  type RuntimeEvent,
  type RuntimeEventId,
  type SerializableJsonRecord,
} from '@linnlabs/linnkit/contracts';
import { withRuntimeEventMetadata } from './functions/withRuntimeEventMetadata';

function buildBaseMappingMetadata(
  options: ConversationNextRequest['options']
): SerializableJsonRecord | undefined {
  const metadata: SerializableJsonRecord = {};
  if (options?.activity) {
    const activity = toSerializableJsonRecord(options.activity);
    if (activity) {
      metadata.activity = activity;
    }
  }
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function serializeRunContextTags(
  tags: runContext.RunContext['tags'],
): SerializableJsonRecord {
  const serialized = toSerializableJsonRecord(tags);
  return serialized ?? {};
}

export interface RunLifecycleCoordinatorOptions {
  conversationId: string;
  turnId: string;
  options: ConversationNextRequest['options'];
  /** 当前 execution 对应的正式用户消息；只用于绑定产品 read model，不参与 routing。 */
  userMessageId?: RuntimeEventId;
}

/**
 * 中文备注：
 * - 这个协调器负责收口 runner 主流程里的 execution-scoped 非路由元数据；
 * - 目标不是增加抽象层，而是把非路由 metadata、正式 run identity 与 hook 调用统一放到一个地方；
 * - 它不拥有 routing identity，也不提供业务扩展 hook。
 */
export class RunLifecycleCoordinator {
  private readonly mappingContext: events.EventMappingContext;

  constructor(private readonly options: RunLifecycleCoordinatorOptions) {
    this.mappingContext = {
      conversationId: options.conversationId,
      turnId: options.turnId,
      metadata: buildBaseMappingMetadata(options.options),
    };
  }

  getMappingContext(): events.EventMappingContext {
    return this.mappingContext;
  }

  enrichRuntimeEvent(event: RuntimeEvent): RuntimeEvent {
    const enriched = withRuntimeEventMetadata(event, this.mappingContext.metadata);
    if (enriched.type !== 'context_usage_snapshot' || !this.options.userMessageId) {
      return enriched;
    }
    return {
      ...enriched,
      user_message_id: this.options.userMessageId,
    };
  }

  configureRunContext(finalRunContext: runContext.RunContext): SerializableJsonRecord | undefined {
    this.mappingContext.metadata = {
      ...(this.mappingContext.metadata ?? {}),
      runtime_trace: toSerializableJsonValue({
        traceId: finalRunContext.traceId,
        rootRunId: finalRunContext.rootRunId,
        tags: serializeRunContextTags(finalRunContext.tags),
      }) ?? {},
    };
    return this.mappingContext.metadata;
  }
}
