import type { CanvasCard } from '../../../../shared';
import type { CanvasRasterTile } from '../../../kernel';
import type { splitCardRasterRegions } from '../../../capabilities/textRasterization';
export interface CanvasCardRasterInput {
  readonly card: CanvasCard;
  readonly scale: number;
  readonly dark: boolean;
  readonly regions: ReturnType<typeof splitCardRasterRegions>;
}
export type CanvasCardRasterOutput =
  | { readonly kind: 'ready'; readonly tiles: readonly CanvasRasterTile[] }
  | { readonly kind: 'failed'; readonly error: unknown };
