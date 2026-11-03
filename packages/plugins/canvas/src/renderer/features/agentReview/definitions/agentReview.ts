import type { Ref } from 'vue';
import type { CanvasAgentGroup, CanvasApprovalResolution, CanvasCardId, CanvasElementId, CanvasRectangle, CanvasResolveApprovalRequest, CanvasUndoResult, CanvasWithdrawGroupRequest } from '@plugin/canvas/shared';
export interface CanvasAgentReviewOptions {
  /** 只在会改正文的审阅动作前保存当前表面草稿；false时不创建写请求。 */
  readonly beforeMutation?: () => Promise<boolean>;
}
export interface CanvasAgentReviewPort {
  groups(documentId: string, viewId: string): Promise<CanvasAgentGroup[]>;
  withdraw(input: CanvasWithdrawGroupRequest): Promise<CanvasUndoResult>;
  approve(input: CanvasResolveApprovalRequest): Promise<CanvasApprovalResolution>;
  complete(documentId: string, groupId: string): Promise<void>;
  review(documentId: string, elementId: CanvasElementId, groupId?: string): Promise<void>;
  subscribe(documentId: string, refresh: () => void): () => void;
}
export interface CanvasReviewTarget {
  readonly id: CanvasCardId;
  readonly groupId: string;
  readonly kind: 'added' | 'updated' | 'deleted';
  readonly bounds: CanvasRectangle;
  readonly title: string;
  readonly description: string;
}
export interface CanvasReviewMarker extends CanvasReviewTarget {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly screenBounds: CanvasRectangle;
}
export interface CanvasReviewDirection {
  readonly direction: 'left' | 'right' | 'top' | 'bottom';
  readonly targets: readonly CanvasReviewMarker[];
}
export interface CanvasWithdrawalSummary {
  readonly mode: 'withdraw' | 'redo';
  readonly actionId: string;
  readonly applied: number;
  readonly skipped: number;
  readonly retained: number;
  readonly details: readonly string[];
  readonly canRedo: boolean;
}
export interface CanvasAgentReviewState {
  readonly groups: Readonly<Ref<readonly CanvasAgentGroup[]>>;
  readonly activeGroupId: Readonly<Ref<string | null>>;
  readonly targetId: Readonly<Ref<CanvasCardId | null>>;
  readonly withdrawal: Readonly<Ref<CanvasWithdrawalSummary | null>>;
  readonly busy: Readonly<Ref<boolean>>;
  readonly error: Readonly<Ref<string | null>>;
  install(groups: readonly CanvasAgentGroup[], activeId: string | null): void;
  select(id: string | null): void;
  focus(id: CanvasCardId): void;
  withdrawn(summary: CanvasWithdrawalSummary): void;
  redone(): void;
  start(): void;
  finish(): void;
  fail(message: string): void;
}
