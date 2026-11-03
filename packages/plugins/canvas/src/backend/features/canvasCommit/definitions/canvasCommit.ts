import type { CanvasElement, CanvasElementId, CanvasSource } from '../../../../shared';
import type { CanvasOperationResult } from '../../../../shared/changeset/definitions/canvasCommands';

export interface CanvasStoredElement {
  readonly element: CanvasElement;
  readonly fieldOrigins: Readonly<Record<string, string>>;
  readonly fieldVersions: Readonly<Record<string, number>>;
}
export interface CanvasCommitState {
  readonly sequence: number;
  readonly nextCard: number;
  readonly nextEdge: number;
  readonly elements: readonly CanvasStoredElement[];
  readonly deletedOrigins: Readonly<Record<string, { readonly origin: string; readonly revision: number }>>;
}
export interface CanvasElementChange {
  readonly id: CanvasElementId;
  readonly before: CanvasElement | null;
  readonly after: CanvasElement | null;
  readonly fields: readonly string[];
}
export interface CanvasEditingClaim {
  readonly elementId: string;
  readonly fields: readonly string[];
}
export interface CanvasCommitPlan {
  readonly origin: string;
  readonly state: CanvasCommitState;
  readonly changes: readonly CanvasElementChange[];
  readonly results: CanvasOperationResult[];
  readonly refs: Record<string, CanvasElementId>;
}
export interface CanvasCommitActor {
  readonly source: CanvasSource;
  readonly viewId: string;
}
export interface CanvasCommitParticipant {
  /** 使用调用方当前事务；不能提交、await 或发送事件。失败抛出以回滚整批。 */
  commit(plan: CanvasCommitPlan, context: CanvasCommitContext): void;
}

export interface CanvasCommitContext {
  readonly documentId: string;
  readonly requestId: string;
  readonly actor: CanvasCommitActor;
  readonly now: number;
}
