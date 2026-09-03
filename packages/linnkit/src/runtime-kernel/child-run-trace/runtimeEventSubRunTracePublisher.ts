import type { RuntimeEventSink } from '../graph-engine/types';
import type { SubRunTraceEnvelope, SubRunTracePublisher } from './subrunTrace.types';
import {
  createSubRunTraceEvent,
  generateRuntimeEventId,
  toSerializableJsonRecord,
  toSerializableJsonValue,
} from '../../contracts';
import type { SubRunTraceEvent, ToolCallId } from '../../contracts';

export interface RuntimeEventSubRunTracePublisherOptions {
  runtimeEventSink: RuntimeEventSink;

  /** 父会话上下文：用于填充 RuntimeEvent 基础字段 */
  conversationId: string;
  turnId: string;

  /** 绑定关系：用于 UI 精确归属与并发分桶 */
  parentToolCallId: ToolCallId;
  subrunId: string;
  subrunParentId?: string;

  /**
   * 事件来源（用于调试与过滤）
   * 建议格式：`subrun:<tool_name>` 或 `tool:<tool_name>:subrun`
   */
  source?: string;

  /**
   * 透传到 RuntimeEvent.metadata 的扩展字段（可选）
   * 注意：metadata 只允许承载非关键展示/诊断信息。路由、归并、生命周期和副作用目标
   * 必须使用共享正式字段或上层显式绑定，不能让前端从这里恢复业务身份。
   */
  metadata?: Record<string, unknown>;

}

/**
 * RuntimeEventSubRunTracePublisher
 *
 * 说明：
 * - 该发布器在构造时绑定 parent_tool_call_id 与 subrun_id；
 * - 每次 publish 只需要提供“分片载荷”（kind/delta/...）即可。
 */
export class RuntimeEventSubRunTracePublisher implements SubRunTracePublisher {
  private readonly runtimeEventSink: RuntimeEventSink;
  private readonly conversationId: string;
  private readonly turnId: string;
  private readonly parentToolCallId: ToolCallId;
  private readonly subrunId: string;
  private readonly subrunParentId?: string;
  private readonly source: string;
  private readonly metadata?: Record<string, unknown>;

  constructor(options: RuntimeEventSubRunTracePublisherOptions) {
    this.runtimeEventSink = options.runtimeEventSink;
    this.conversationId = options.conversationId;
    this.turnId = options.turnId;
    this.parentToolCallId = options.parentToolCallId;
    this.subrunId = options.subrunId;
    this.subrunParentId = options.subrunParentId;
    this.source = options.source ?? 'subrun_trace';
    this.metadata = options.metadata;
  }

  publish(envelope: SubRunTraceEnvelope): void {
    // 🔥 关键：event.id 必须每条都唯一，否则前端 processedEvents 会丢弃重复事件
    const id = generateRuntimeEventId();

    const options: Partial<SubRunTraceEvent> & Pick<SubRunTraceEvent, 'source_event_id'> = {
      // 绑定多级归属（如未来支持子 run 树）
      subrun_parent_id: this.subrunParentId,
      source_event_id: envelope.source_event_id,

      // 载荷透传
      ...('delta' in envelope ? { delta: envelope.delta } : {}),
      ...('content' in envelope ? { content: envelope.content } : {}),
      ...('answer_id' in envelope ? { answer_id: envelope.answer_id } : {}),
      ...('seq' in envelope ? { seq: envelope.seq } : {}),
      ...('is_last' in envelope && envelope.is_last !== undefined
        ? { is_last: envelope.is_last }
        : {}),
      ...('completion_reason' in envelope ? { completion_reason: envelope.completion_reason } : {}),
      ...('tool_name' in envelope ? { tool_name: envelope.tool_name } : {}),
      ...('tool_call_id' in envelope ? { tool_call_id: envelope.tool_call_id } : {}),
      ...('phase' in envelope ? { phase: envelope.phase } : {}),
      ...('status' in envelope ? { status: envelope.status } : {}),
      ...('tool_calls' in envelope ? { tool_calls: [...envelope.tool_calls] } : {}),
      ...('args' in envelope ? { args: toSerializableJsonRecord(envelope.args) } : {}),
      ...('output' in envelope ? { output: toSerializableJsonValue(envelope.output) } : {}),
      ...('attachments' in envelope && envelope.attachments !== undefined
        ? { attachments: [...envelope.attachments] }
        : {}),
      ...('duration_ms' in envelope && envelope.duration_ms !== undefined
        ? { duration_ms: envelope.duration_ms }
        : {}),
      ...('original_message_count' in envelope
        ? { original_message_count: envelope.original_message_count }
        : {}),
      ...('replaced_message_ids' in envelope
        ? { replaced_message_ids: [...envelope.replaced_message_ids] }
        : {}),
      ...('compression_ratio' in envelope && envelope.compression_ratio !== undefined
        ? { compression_ratio: envelope.compression_ratio }
        : {}),
      ...('included_old_summary' in envelope && envelope.included_old_summary !== undefined
        ? { included_old_summary: envelope.included_old_summary }
        : {}),
      meta: toSerializableJsonRecord(envelope.meta),

      // 可选 metadata 透传（用于前端调试/归类）
      metadata: toSerializableJsonRecord(this.metadata),
    };

    // createSubRunTraceEvent 内部默认设置 ephemeral=true（瞬时事件，不应持久化）
    const runtimeEvent = createSubRunTraceEvent(
      id,
      this.conversationId,
      this.turnId,
      this.parentToolCallId,
      this.subrunId,
      envelope.kind,
      options
    );

    this.runtimeEventSink(runtimeEvent, this.source);
  }
}
