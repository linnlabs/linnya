import type { RoutedRuntimeEvent, RuntimeEvent } from '@linnlabs/linnkit/contracts';
import type { WorkspaceAssetCommitRecord } from 'src/features/workspace/assets/definitions/workspaceAssetCommit';

/** 当前轮 wire DTO 经 host 校验后形成的唯一事实批次。 */
export interface FlowIncomingEventBatch {
  readonly events: readonly RuntimeEvent[];
  readonly assetCommitsByEventId: ReadonlyMap<string, readonly WorkspaceAssetCommitRecord[]>;
  /** SQLite event/link 事务成功后才能释放的 draft 身份。 */
  readonly committedDraftIds: readonly string[];
}

/** run admission 已完成；该批事实可进入 durable commit 与 EventBus。 */
export interface RoutedFlowIncomingEventBatch {
  readonly events: readonly RoutedRuntimeEvent[];
  readonly assetCommitsByEventId: ReadonlyMap<string, readonly WorkspaceAssetCommitRecord[]>;
  /** SQLite event/link 事务成功后才能释放的 draft 身份。 */
  readonly committedDraftIds: readonly string[];
}
