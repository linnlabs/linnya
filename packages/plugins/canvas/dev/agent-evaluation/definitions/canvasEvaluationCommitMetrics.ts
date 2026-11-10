import type { CanvasCardId, CanvasChangedEvent } from '@plugin/canvas/shared';
import type { CanvasRasterReadiness } from '../../../src/renderer/orchestration/createCanvasRasterPresentation';
import type { CanvasEvaluationCommitScope } from '../readCanvasEvaluationCommitScopes';
import type { createCanvasEvaluationCommitFrameWindows } from '../createCanvasEvaluationCommitFrameWindows';

export interface FrameReceipt {
  readonly observedAt: number;
  readonly displayedSequence: number;
  readonly drawCount: number;
  readonly commitToFrameUpperBoundMs?: number;
}
export interface BodyFrameReceipt extends FrameReceipt {
  readonly visibleBodyIds: readonly CanvasCardId[];
  readonly presentedBodyIds: readonly CanvasCardId[];
}
export interface BodyReceipt {
  readonly status: 'ready' | 'pending' | 'failed' | 'incomplete' | 'no-visible-body' | 'unattributed' | 'not-required';
  readonly visibleBodyIds: readonly CanvasCardId[];
  readonly readiness?: CanvasRasterReadiness;
  readonly frame?: FrameReceipt;
  readonly firstVisible?: BodyFrameReceipt;
  readonly allVisible?: BodyFrameReceipt;
  readonly supersededCardIds?: readonly CanvasCardId[];
}
export interface CommitFrame {
  readonly event: CanvasChangedEvent;
  readonly receivedAt: number;
  readonly status: 'observing' | 'presented' | 'not-visible' | 'not-presented' | 'closed' | 'failed';
  readonly scope?: CanvasEvaluationCommitScope;
  readonly geometry?: FrameReceipt;
  readonly body?: BodyReceipt;
  readonly frames?: ReturnType<ReturnType<typeof createCanvasEvaluationCommitFrameWindows>['finish']>;
  readonly error?: string;
}
