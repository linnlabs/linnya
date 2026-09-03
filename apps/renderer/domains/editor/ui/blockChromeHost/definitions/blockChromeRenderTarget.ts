import type { BlockChromeRenderPlan } from './blockChromeRenderPlan';

export interface BlockChromeRenderTarget {
  plan: BlockChromeRenderPlan;
  anchorElement: HTMLElement;
}

