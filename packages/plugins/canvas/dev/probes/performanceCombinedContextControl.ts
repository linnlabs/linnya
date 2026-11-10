import { createCanvasStagingContextControl } from './performanceStagingContextControl';
import { createCanvasTileContextControl } from './performanceTileContextControl';
import type { CanvasPerformanceContextArm } from './performanceContextControl';

type StagingFacts = ReturnType<ReturnType<typeof createCanvasStagingContextControl>['finish']>;
type TileFacts = ReturnType<ReturnType<typeof createCanvasTileContextControl>['finish']>;

/** 只组合两个固定诊断owner；改变两端hint仍须各自实际属性和tile归属自证。 */
export function createCanvasCombinedContextControl(host: HTMLElement, arm: CanvasPerformanceContextArm): {
  finish(): { readonly diagnostic: 'staging-and-tile-context-control'; readonly arm: CanvasPerformanceContextArm;
    readonly staging: StagingFacts; readonly tile: TileFacts; readonly effective: boolean };
} {
  const staging = createCanvasStagingContextControl(arm);
  let tile: ReturnType<typeof createCanvasTileContextControl>;
  try { tile = createCanvasTileContextControl(host, arm); }
  catch (error) { staging.finish(); throw error; }
  return {
    finish() {
      let stagingFacts: ReturnType<typeof staging.finish>, tileFacts: ReturnType<typeof tile.finish>;
      // BODY先卸载paint；这里再逆序还原tile与staging，即使tile收口失败也恢复staging。
      try { tileFacts = tile.finish(); } finally { stagingFacts = staging.finish(); }
      return { diagnostic: 'staging-and-tile-context-control', arm, staging: stagingFacts, tile: tileFacts,
        effective: stagingFacts.effective && tileFacts.effective };
    },
  };
}
