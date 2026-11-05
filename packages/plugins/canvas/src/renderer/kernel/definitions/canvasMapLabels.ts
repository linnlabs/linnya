import type { CanvasCamera, CanvasCard, CanvasRectangle } from '../../../shared';

export interface CanvasMapLabelText { readonly text: string; readonly width: number }
export interface CanvasMapLabelCollisionIndex {
  blocksAnchor(x: number, y: number, lineHeight: number): boolean;
  intersects(bounds: CanvasRectangle): boolean;
  insert(bounds: CanvasRectangle): void;
}

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
