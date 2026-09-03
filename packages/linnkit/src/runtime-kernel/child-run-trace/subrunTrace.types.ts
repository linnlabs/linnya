import type {
  FinalAnswerCompletionReason,
  RuntimeResourceRef,
  SerializableJsonRecord,
  SubRunTraceEvent,
  SubRunTraceToolCallDecision,
  ToolCallId,
} from '../../contracts';

/**
 * 子 run trace 的“业务无关”发布载荷。
 *
 * 说明：
 * - 该结构刻意只包含 subrun_trace 的 payload 字段（不包含 conversation_id/turn_id 等基础字段）
 * - parent_tool_call_id/subrun_id 是发布器构造时绑定的，不需要每次 publish 重复提供
 */
interface SubRunTraceEnvelopeBase {
  /** child RuntimeEvent 的稳定身份；parent trace 必须与 source fact 一一对应。 */
  source_event_id: string;
  /** 只允许非路由、非归并的附加展示信息。 */
  meta?: SerializableJsonRecord;
}

export type SubRunTraceEnvelope = SubRunTraceEnvelopeBase &
  (
    | { kind: 'thought_delta'; delta: string }
    | { kind: 'thought_complete'; content: string }
    | {
        kind: 'tool_call_decision';
        tool_calls: readonly SubRunTraceToolCallDecision[];
      }
    | {
        kind: 'tool_process';
        tool_name: string;
        tool_call_id: ToolCallId;
        phase: NonNullable<SubRunTraceEvent['phase']>;
        status: NonNullable<SubRunTraceEvent['status']>;
        args: SerializableJsonRecord;
      }
    | {
        kind: 'tool_output';
        tool_name: string;
        tool_call_id: ToolCallId;
        status: 'success';
        output: NonNullable<SubRunTraceEvent['output']>;
        attachments?: readonly RuntimeResourceRef[];
        duration_ms?: number;
      }
    | {
        kind: 'tool_output';
        tool_name: string;
        tool_call_id: ToolCallId;
        status: 'error';
        output: NonNullable<SubRunTraceEvent['output']>;
        duration_ms?: number;
      }
    | {
        kind: 'final_answer_chunk';
        answer_id: string;
        seq: number;
        delta: string;
        is_last?: boolean;
      }
    | {
        kind: 'final_answer';
        answer_id: string;
        content: string;
        completion_reason: FinalAnswerCompletionReason;
      }
    | {
        kind: 'history_summary';
        original_message_count: number;
        replaced_message_ids: readonly string[];
        compression_ratio?: number;
        included_old_summary?: boolean;
      }
  );

/**
 * 子 run trace 发布器接口（面向业务工具层）。
 *
 * 约束：
 * - 发布器必须确保生成的 RuntimeEvent 为 `type='subrun_trace'` 且 `ephemeral=true`
 * - 发布器应保证每条事件的 id 唯一（用于前端 processedEvents 幂等去重）
 */
export interface SubRunTracePublisher {
  publish(envelope: SubRunTraceEnvelope): void;
}
