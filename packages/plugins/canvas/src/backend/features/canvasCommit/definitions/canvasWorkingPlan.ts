import type { CanvasElementId } from '../../../../shared';
import type { CanvasOperationResult } from '../../../../shared/changeset/definitions/canvasCommands';
import type { CanvasRectangle } from '../../../../shared/geometry/definitions/canvasGeometry';
import type {
  CanvasCommitActor,
  CanvasEditingClaim,
  CanvasElementChange,
  CanvasStoredElement,
} from './canvasCommit';

export interface CanvasWorkingPlan {
  origin: string;
  layoutTargets: ReadonlySet<string>;
  reservedRectangles: readonly CanvasRectangle[];
  elements: Map<CanvasElementId, CanvasStoredElement>;
  changes: CanvasElementChange[];
  results: CanvasOperationResult[];
  refs: Record<string, CanvasElementId>;
  nextCard: number;
  nextEdge: number;
  /** 本批见过的最高层级；删除最高元素后也无需重新排序全部元素。 */
  lastOrder: string | null;
  actor: CanvasCommitActor;
  claims: readonly CanvasEditingClaim[];
  now: number;
}
