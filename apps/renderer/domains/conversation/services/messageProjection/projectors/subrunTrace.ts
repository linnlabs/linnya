import type {
  MessageProjectionState,
  ProjectionResult,
  RunProjectionState,
} from '../state';
import { getMessageById, updateMessage } from '../helpers/messageAccess';
import { isRecord } from '../../../utils/typeGuards';
import { markRaw } from 'vue';
import { admitCitationsFromConversationSubrunOutput } from '@linnya/citation-domain/conversation-presentation';
import { projectConversationCitationRegistration } from '../../../features/citation-presentation';
import type { SSESubRunTraceEvent } from '@linnlabs/linnkit/contracts';
import {
  appendSubrunTraceSummary,
  readSubrunTraceSummary,
} from '../../../features/subrun-trace';
import { projectToolCardPresentation } from '../../../ports/toolPresentationProjectionPort';
import { buildToolResultFromMessage } from '../../message/tool/buildToolResultFromMessage';

/**
 * @description
 * subrun_trace 投影器：把子 run 过程事件挂载到父 tool_calls message 的 metadata 上。
 *
 * 关键约束：
 * - 不创建任何新的 BaseMessage（避免污染主 timeline）
 * - 仅通过 parent_tool_call_id 找到父工具消息，并在其 metadata 上追加 trace
 */

type SubRunTraceBucket = {
  /** 子 run 唯一标识 */
  subrun_id: string;
  /** 按到达顺序追加的事件列表（事件 id 已由 processedEvents 去重） */
  events: SSESubRunTraceEvent[];
};

function isSubRunTraceBucket(value: unknown): value is SubRunTraceBucket {
  if (!isRecord(value)) return false;
  if (typeof value.subrun_id !== 'string' || value.subrun_id.length === 0) return false;
  if (!Array.isArray(value.events)) return false;
  return true;
}

export function projectSubRunTraceEvent(
  state: MessageProjectionState,
  runState: RunProjectionState,
  event: SSESubRunTraceEvent,
): ProjectionResult {
  const parentToolCallId = event.parent_tool_call_id;
  const subrunId = event.subrun_id;

  if (!parentToolCallId || !subrunId) {
    return { success: false, reason: 'Missing parent_tool_call_id or subrun_id for subrun_trace event' };
  }

  const toolState = runState.toolState.get(parentToolCallId);
  if (!toolState) {
    // 这里不做兜底缓存：subrun_trace 必须能精确挂载到父工具消息，缺失说明事件顺序或投影链路异常
    return { success: false, reason: `No tool_calls message found for parent_tool_call_id=${parentToolCallId}` };
  }

  const message = getMessageById(state, toolState.messageId);
  if (!message) {
    return { success: false, reason: `tool_calls message not found: messageId=${toolState.messageId}` };
  }
  if (message.type !== 'tool_calls') {
    return {
      success: false,
      reason: `subrun parent must be tool_calls: messageId=${toolState.messageId}, type=${message.type}`,
    };
  }

  const citationAdmission = event.kind === 'tool_output' && typeof event.tool_name === 'string'
    ? admitCitationsFromConversationSubrunOutput({
        toolName: event.tool_name,
        status: event.status === 'success'
          ? 'success'
          : event.status === 'error'
            ? 'error'
            : 'loading',
        output: event.output,
      })
    : null;
  const nextCitationWorkspace = citationAdmission
    ? projectConversationCitationRegistration(
        state.citationWorkspace,
        event.turn_id,
        citationAdmission.citations,
      )
    : state.citationWorkspace;

  const previousSummary = readSubrunTraceSummary(message.metadata?.subrun_summary);
  const appendedSummary = appendSubrunTraceSummary(previousSummary, subrunId);
  // schema DTO 使用可变容器，domain 计算结果保持 readonly；只在投影写边界复制一次。
  const nextSummary = {
    subrun_ids: [...appendedSummary.subrun_ids],
    event_counts: { ...appendedSummary.event_counts },
  };
  const discoveredNewChild = !previousSummary.subrun_ids.includes(subrunId);
  /**
   * presentation admission 必须发生在 mutable message 更新之前。
   *
   * 参考 `docs/conversation-platform/09-tools.md`（INV-56）与 `08-lifecycle.md`：single
   * SubrunCard 的运行中身份来自首条 summary；若 projector 拒绝冲突，旧消息必须保持完整，
   * 不能留下 metadata 已更新而 presentation 仍陈旧的半提交状态。
   */
  const projectedToolPresentation = discoveredNewChild
    ? projectToolCardPresentation({
      sourceToolName: message.metadata.tool_name,
      toolCallId: message.metadata.tool_call_id,
      args: message.metadata.args ?? {},
      result: buildToolResultFromMessage(message.content, message.metadata),
      interaction: message.metadata.interaction,
      subrunSummary: nextSummary,
      status: message.metadata.status,
      phase: message.metadata.phase,
    })
    : undefined;

  updateMessage(state, message.id, (msg) => {
    if (msg.type !== 'tool_calls') {
      throw new Error(`subrun parent changed message type during projection: ${msg.id}`);
    }
    /**
     * 性能根因修复：subrun_trace 是高频增量事件
     *
     * 旧实现每次都做：
     * - events: [...existingBucket.events, event]（复制整段历史）
     * - subrunTrace: { ...prevTrace, [subrunId]: nextBucket }（复制整张 trace 表）
     * - msg.metadata = { ...prevMeta, subrunTrace: ... }（复制整份 metadata）
     *
     * 这会形成典型的 O(n^2) 拷贝/GC 压力：事件越多越卡，尤其在子 agent 收尾 burst 时最明显。
     *
     * 新实现严格遵循事件契约：
     * - subrun_trace 必须通过 parent_tool_call_id 精确挂载；
     * - 事件按到达顺序“追加”到 bucket.events；
     * - 不做任何推测性结构补全（只有结构明确时才复用）。
     */
    // tool_calls 已在函数入口完成判别，metadata 必须保持正式 schema 类型，禁止降级成任意 Record。
    const metaBase = msg.metadata;

    // 与历史 read-model 保持同一轻量索引口径，UI 无需扫描完整 trace 树来发现 child runs。
    metaBase.subrun_summary = nextSummary;
    // 没有 projector 的 trace 工具并不拥有 presentation 迁移权限；只在 owner 明确产出时替换。
    if (projectedToolPresentation) {
      msg.toolPresentation = projectedToolPresentation;
    }

    const traceValue = metaBase.subrunTrace;
    /**
     * ✅ 根因级性能修复（响应式雪崩）：
     * - subrun_trace 会无限追加 events[]，如果把整个树交给 Vue 深度响应式代理，
     *   会导致依赖追踪/代理开销随事件数量线性增长（最终表现为“越跑越卡，UI 很久才更新一次”）。
     * - 这里将 subrunTrace 结构标记为 markRaw，禁止 Vue 深度代理；
     * - 同时维护一个轻量计数器 subrunTraceVersion（number），供 UI 侧做增量 watch。
     *
     * 约束：
     * - 不改变事件语义：仍然保留完整 events 历史；
     * - 不做任何推测式丢弃；
     * - UI 只 watch version（原始 number），避免 watch 大数组的 length/深层依赖。
     */
    const traceMap: Record<string, unknown> = isRecord(traceValue)
      ? traceValue
      : markRaw<Record<string, unknown>>({});
    if (!isRecord(traceValue)) {
      metaBase.subrunTrace = traceMap;
    }

    const existingBucketValue = traceMap[subrunId];
    if (isSubRunTraceBucket(existingBucketValue)) {
      existingBucketValue.events.push(event);
      const prevV = metaBase.subrunTraceVersion;
      const nextV = typeof prevV === 'number' && Number.isFinite(prevV) ? prevV + 1 : 1;
      metaBase.subrunTraceVersion = nextV;
      return;
    }

    // bucket 不存在或结构不明确：创建一次即可，后续只做 push
    const bucket: SubRunTraceBucket = {
      subrun_id: subrunId,
      // 事件数组同样 markRaw：避免 Vue 代理每个 event 元素
      events: markRaw([event]),
    };
    traceMap[subrunId] = bucket;
    const prevV = metaBase.subrunTraceVersion;
    const nextV = typeof prevV === 'number' && Number.isFinite(prevV) ? prevV + 1 : 1;
    metaBase.subrunTraceVersion = nextV;
  });
  state.citationWorkspace = nextCitationWorkspace;

  return { success: true, messageId: message.id, newState: state };
}
