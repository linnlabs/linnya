import { ref, type Ref } from 'vue';
import { clampKonvaRasterScale } from '../functions/konvaRasterScale';

export interface KonvaRasterScaleOptions {
  maxRasterScale: number;
  settleDelayMs: number;
}

export interface KonvaRasterScaleController {
  konvaRasterScale: Ref<number>;
  commitKonvaRasterScale: (nextScale: number) => void;
  scheduleKonvaRasterScaleCommit: (nextScale: number) => void;
  cancelKonvaRasterCommit: () => void;
  disposeKonvaRasterScale: () => void;
}

/**
 * 管理 Konva raster scale 的提交节奏。
 * 高频缩放时先保留旧 canvas 位图，由外层 CSS scale 跟手；缩放停稳后再提交新的 raster scale。
 */
export function useKonvaRasterScale(
  options: KonvaRasterScaleOptions,
): KonvaRasterScaleController {
  const konvaRasterScale = ref(1);
  let konvaRasterCommitTimeoutId: number | null = null;

  function cancelKonvaRasterCommit(): void {
    if (konvaRasterCommitTimeoutId === null) {
      return;
    }

    window.clearTimeout(konvaRasterCommitTimeoutId);
    konvaRasterCommitTimeoutId = null;
  }

  function commitKonvaRasterScale(nextScale: number): void {
    cancelKonvaRasterCommit();
    konvaRasterScale.value = clampKonvaRasterScale(nextScale, options.maxRasterScale);
  }

  function scheduleKonvaRasterScaleCommit(nextScale: number): void {
    cancelKonvaRasterCommit();
    const clamped = clampKonvaRasterScale(nextScale, options.maxRasterScale);
    konvaRasterCommitTimeoutId = window.setTimeout(() => {
      konvaRasterCommitTimeoutId = null;
      konvaRasterScale.value = clamped;
    }, options.settleDelayMs);
  }

  function disposeKonvaRasterScale(): void {
    cancelKonvaRasterCommit();
  }

  return {
    konvaRasterScale,
    commitKonvaRasterScale,
    scheduleKonvaRasterScaleCommit,
    cancelKonvaRasterCommit,
    disposeKonvaRasterScale,
  };
}
