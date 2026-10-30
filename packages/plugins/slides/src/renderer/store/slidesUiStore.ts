/**
 * Slides UI 状态
 *
 * 纯 UI 层状态：视图模式、页面条收起、缩放级别。
 * 不涉及领域事实数据，也不涉及异步流程。
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import {
  ZOOM_DEFAULT,
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_STEP,
} from '../shared/constants';
import { computeSteppedZoomLevel } from '../shared/zoomBehavior';

type ZoomMode = 'fit' | 'manual';

/** 主区域展示单页舞台还是全稿平铺；平铺时底部页面条与舞台工具条隐藏。 */
export type DeckViewMode = 'slide' | 'grid';

export const useSlidesUiStore = defineStore('slides-ui', () => {
  // ─── State ───

  /** 主区域视图 */
  const deckViewMode = ref<DeckViewMode>('slide');

  /** 单页视图下底部页面条是否收起 */
  const filmstripCollapsed = ref(false);

  /** 画布缩放级别（1 = 100%） */
  const zoomLevel = ref(ZOOM_DEFAULT);

  /** fit 模式下当前视口推导出的缩放级别 */
  const fitZoomLevel = ref(ZOOM_DEFAULT);

  /** 当前缩放来源：自适应 fit 或用户手动缩放 */
  const zoomMode = ref<ZoomMode>('fit');

  /** 当前是否处于 fit 模式 */
  const isFitZoom = computed(() => zoomMode.value === 'fit');

  function getDisplayedZoomLevel(): number {
    return zoomMode.value === 'fit' ? fitZoomLevel.value : zoomLevel.value;
  }

  // ─── Actions ───

  function setDeckViewMode(mode: DeckViewMode) {
    deckViewMode.value = mode;
  }

  function toggleFilmstrip() {
    filmstripCollapsed.value = !filmstripCollapsed.value;
  }

  function zoomIn() {
    zoomMode.value = 'manual';
    zoomLevel.value = computeSteppedZoomLevel({
      currentZoom: getDisplayedZoomLevel(),
      direction: 'in',
      step: ZOOM_STEP,
      minZoom: ZOOM_MIN,
      maxZoom: ZOOM_MAX,
    });
  }

  function zoomOut() {
    zoomMode.value = 'manual';
    zoomLevel.value = computeSteppedZoomLevel({
      currentZoom: getDisplayedZoomLevel(),
      direction: 'out',
      step: ZOOM_STEP,
      minZoom: ZOOM_MIN,
      maxZoom: ZOOM_MAX,
    });
  }

  function setZoom(level: number, mode: ZoomMode = 'manual') {
    zoomMode.value = mode;
    zoomLevel.value = Math.max(ZOOM_MIN, Math.min(level, ZOOM_MAX));
  }

  /** 同步 fit 模式下的缩放显示值，不污染手动缩放状态 */
  function syncFitZoomLevel(level: number) {
    // fit 可小于手动缩放下限；显示和实际舞台必须使用同一个精确值。
    fitZoomLevel.value = level;
  }

  /** 切回 fit 模式 */
  function zoomToFit() {
    zoomMode.value = 'fit';
  }

  function $reset() {
    deckViewMode.value = 'slide';
    filmstripCollapsed.value = false;
    zoomMode.value = 'fit';
    zoomLevel.value = ZOOM_DEFAULT;
    /**
     * fitZoomLevel 是当前舞台视口推导值，不是 deck 私有状态。
     * deck 切换时保留上一帧结果，避免缩放栏短暂回落到 100% 再被新舞台回填。
     */
  }

  return {
    // State
    deckViewMode,
    filmstripCollapsed,
    zoomLevel,
    fitZoomLevel,
    zoomMode,
    // Computed
    isFitZoom,
    // Actions
    setDeckViewMode,
    toggleFilmstrip,
    zoomIn,
    zoomOut,
    setZoom,
    syncFitZoomLevel,
    zoomToFit,
    $reset,
  };
});
