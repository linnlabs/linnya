export { commitCanvasOperations } from './orchestration/commitCanvasOperations';
export type { CanvasCommitPorts } from './orchestration/commitCanvasOperations';
export { readCanvasSnapshot, updateCanvasEditingClaim } from './persistence/canvasRepository';
export type { CanvasCommitActor, CanvasCommitParticipant, CanvasCommitPlan, CanvasElementChange } from './definitions/canvasCommit';

export { createEmptyCanvasDocument as initializeCanvasDocument, readCanvasSynchronization } from './persistence/canvasRepository';
export type { CanvasCommitContext } from './definitions/canvasCommit';
export { commitCanvasTransition } from './orchestration/commitCanvasOperations';
export { validateCanvasGraph } from './functions/validateCanvasGraph';
export type { CanvasCommitState, CanvasStoredElement, CanvasEditingClaim } from './definitions/canvasCommit';
