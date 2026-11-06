import type { CanvasCamera, CanvasCard, CanvasCardId, CanvasElement } from '@plugin/canvas/shared';
import type { CanvasKernel } from '../../kernel';

export interface CanvasViewportCommandsOptions {
  readonly kernel: Pick<
    CanvasKernel,
    | 'canvas'
    | 'fit'
    | 'readCamera'
    | 'setCamera'
    | 'readEdgeGeometry'
    | 'finishTransitions'
    | 'animateCamera'
  >;
  readonly setCamera: (value: CanvasCamera) => void;
  readonly refresh: () => void;
  readonly cards: () => readonly CanvasCard[];
  readonly selected: () => readonly CanvasCard[];
  readonly elements: () => readonly CanvasElement[];
  readonly select: (ids: readonly CanvasCardId[]) => Promise<boolean>;
  readonly selectEdge: (id: Extract<CanvasElement, { type: 'edge' }>['id']) => Promise<boolean>;
}
