import type { Ref } from 'vue';
import type { CanvasAgentGroup, CanvasApprovalResolution, CanvasElementId, CanvasResolveApprovalRequest, CanvasUndoResult, CanvasWithdrawGroupRequest } from '@plugin/canvas/shared';
export interface CanvasAgentReviewPort {
  groups(documentId: string, viewId: string): Promise<CanvasAgentGroup[]>;
  withdraw(input: CanvasWithdrawGroupRequest): Promise<CanvasUndoResult>;
  approve(input: CanvasResolveApprovalRequest): Promise<CanvasApprovalResolution>;
  complete(documentId: string, groupId: string): Promise<void>;
  review(documentId: string, elementId: CanvasElementId, groupId?: string): Promise<void>;
  subscribe(documentId: string, refresh: () => void): () => void;
}
export interface CanvasAgentReviewState {
  readonly groups: Readonly<Ref<readonly CanvasAgentGroup[]>>;
  readonly activeGroupId: Readonly<Ref<string | null>>;
  readonly busy: Readonly<Ref<boolean>>;
  readonly error: Readonly<Ref<string | null>>;
  install(groups: readonly CanvasAgentGroup[]): void;
  select(id: string | null): void;
  start(): void;
  finish(): void;
  fail(message: string): void;
}
