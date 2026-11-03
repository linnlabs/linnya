import type { CanvasSnapshot } from '../../../../shared';
import type { CanvasCommitActor, CanvasCommitState, CanvasEditingClaim } from '../../canvasCommit';

export interface CanvasVersionRestorationInput {
  readonly state: CanvasCommitState;
  readonly targetSnapshot: CanvasSnapshot;
  readonly actor: CanvasCommitActor;
  readonly claims: readonly CanvasEditingClaim[];
  readonly origin: string;
  readonly now: number;
}
