import type { ActiveChromeSource } from './activeChromeBlocks';

export const BLOCK_CHROME_SURFACE_ORDER = [
  'left-handle',
  'annotation-handle',
  'revision-toolbar',
  'history-panel',
] as const;

export type BlockChromeSurface = (typeof BLOCK_CHROME_SURFACE_ORDER)[number];

export interface BlockChromeRenderPlan {
  blockId: string;
  sources: readonly ActiveChromeSource[];
  surfaces: readonly BlockChromeSurface[];
  targetReady: boolean;
}
