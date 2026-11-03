import type { CanvasCamera, CanvasCard } from '../../../shared';

export interface CanvasMapLabelsInput {
  readonly cards: readonly CanvasCard[];
  readonly camera: CanvasCamera;
  readonly width: number;
  readonly height: number;
  readonly dark: boolean;
  readonly visible: boolean;
  readonly readTitle?: (card: CanvasCard) => string;
  readonly readOpacity?: (id: CanvasCard['id']) => number;
}
export type CanvasMapLabelsProjection = Pick<CanvasMapLabelsInput, 'cards' | 'camera' | 'width' | 'height' | 'dark'>;
