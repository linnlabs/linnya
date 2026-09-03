import type { SSESubRunTraceEvent, SubRunTraceEvent } from 'linnkit/contracts';
import type { HistoricalSubrunTraceKind } from '@linnya/plugin-host-contract/renderer/subrunToolUi';

export type { HistoricalSubrunTraceLazySource } from '@linnya/plugin-host-contract/renderer/subrunToolUi';
export type { SubrunTraceSummary } from '@app/schemas';

/** decision 仅用于恢复参数身份，不投影成可见步骤。 */
export const SUBRUN_TRACE_STEP_KINDS = [
  'tool_call_decision',
  'tool_process',
  'tool_output',
] as const;

export const SUBRUN_TRACE_SUBRUN_CARD_KINDS = [
  'thought_delta',
  'tool_process',
  'tool_output',
  'tool_call_decision',
  'thought_complete',
  'final_answer_chunk',
  'final_answer',
  'history_summary',
] as const;

export type SubrunTraceKind = HistoricalSubrunTraceKind;

export interface SubrunTraceBucket {
  readonly subrun_id: string;
  readonly events: readonly SSESubRunTraceEvent[];
}

export type SubrunTraceBucketMap = Record<string, SubrunTraceBucket>;

export interface SubrunTraceReadyDto {
  readonly success: true;
  readonly conversation_id: string;
  readonly parent_tool_call_id: string;
  readonly subrun_id: string;
  readonly events: readonly SubRunTraceEvent[];
  readonly next_cursor: number | null;
  readonly revision: number;
}

export interface SubrunTracePreparingDto {
  readonly success: false;
  readonly status: 'preparing';
  readonly conversation_id: string;
}

export type SubrunTraceDto = SubrunTraceReadyDto | SubrunTracePreparingDto;

export interface ReadSubrunTraceOptions {
  readonly subrunId: string;
  readonly kinds: readonly SubrunTraceKind[];
  readonly limit?: number;
  readonly cursor?: number;
}

export interface SubrunTraceApiPort {
  readSubrunTrace(
    conversationId: string,
    parentToolCallId: string,
    options: ReadSubrunTraceOptions,
  ): Promise<SubrunTraceDto>;
}

export interface LoadedSubrunTrace {
  readonly status: 'ready';
  readonly buckets: SubrunTraceBucketMap;
  readonly eventCount: number;
  readonly nextCursor: number | null;
  readonly revision: number;
}

export interface PreparingSubrunTrace {
  readonly status: 'preparing';
}

export type LoadSubrunTraceResult = LoadedSubrunTrace | PreparingSubrunTrace;

/**
 * Host 内跨 surface 复用的已接纳 durable trace 快照。
 *
 * key 已包含 conversation、parent tool、subrun 与 kinds；invalidationRevision 防止取消收尾后
 * 新挂载的卡片误用旧快照。缓存只保存完整分页结果，不保存 loading/error 等请求状态。
 */
export interface SubrunTraceHistoryCachePort {
  read(sourceKey: string, invalidationRevision: number): LoadedSubrunTrace | null;
  write(sourceKey: string, invalidationRevision: number, trace: LoadedSubrunTrace): void;
}
