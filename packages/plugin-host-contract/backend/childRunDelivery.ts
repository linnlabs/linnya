import type { BackendPluginCliExecutionContext } from './pluginCli';
import type { runSupervisor } from '@linnlabs/linnkit/runtime-kernel';
import type { SubagentResult } from '@app/schemas';

/** 某一时刻实际保存的文档投影；不是生产时版本认证，也不是内容正确性认证。 */
export interface PluginDocumentObservation {
  readonly inode: string;
  readonly path: string;
  readonly versionNumber: number;
  readonly pendingCount: number;
  readonly sha256: string;
}
export declare class DocumentObservationUnavailableError extends Error {}
export interface PluginChildRunDelivery {
  readonly toolCallId: string;
  readonly prompt: string;
  readonly type: string;
  readonly result: SubagentResult['data'];
  readonly children: readonly SubagentResult['data'][];
}
export type PluginChildRunStatus = runSupervisor.RunStatus;
export interface PluginChildRunDeliveryReader {
  /** 仅当前会话的已提交 subagent 调用；runId 是定位，不授予跨会话权限。 */
  readRunStatus(runId: string): Promise<PluginChildRunStatus | null>;
  read(runId: string): readonly PluginChildRunDelivery[];
  observeDocument(locatorOrInode: string): Promise<PluginDocumentObservation>;
}
export declare function createChildRunDeliveryReader(context: BackendPluginCliExecutionContext): Promise<PluginChildRunDeliveryReader>;
