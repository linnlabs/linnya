/**
 * Slides UI 状态
 *
 * 纯 UI 层状态：面板展开/收起、缩放级别、选中元素、overlay 开关等。
 * 不涉及领域事实数据，也不涉及异步流程。
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { InspectorTab } from '../types/preview';
import {
  ZOOM_DEFAULT,
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_STEP,
} from '../shared/constants';
import { computeSteppedZoomLevel } from '../shared/zoomBehavior';

type ZoomMode = 'fit' | 'manual';

export const useSlidesUiStore = defineStore('slides-ui', () => {
  // ─── State ───

  /** 左侧 outline 面板是否收起 */
  const outlineCollapsed = ref(false);

  /** 右侧 inspector 面板当前 tab */
  const inspectorTab = ref<InspectorTab>('overview');

  /** 右侧 inspector 面板是否可见 */
  const inspectorVisible = ref(false);

  /** 画布缩放级别（1 = 100%） */
  const zoomLevel = ref(ZOOM_DEFAULT);

  /** fit 模式下当前视口推导出的缩放级别 */
  const fitZoomLevel = ref(ZOOM_DEFAULT);

  /** 当前缩放来源：自适应 fit 或用户手动缩放 */
  const zoomMode = ref<ZoomMode>('fit');

  /** 当前选中的元素 ID */
  const selectedElementId = ref<string | null>(null);

  /** 是否显示布局警告 overlay */
  const showLayoutWarnings = ref(false);

  /** 是否进入源码元素选择模式；只有用户显式打开后，舞台点击才会被 source selection 接管 */
  const sourceSelectionModeEnabled = ref(false);

  // ─── Computed ───

  /** 缩放百分比显示文本 */
  const zoomPercentText = computed(() => {
    const displayedZoom = zoomMode.value === 'fit' ? fitZoomLevel.value : zoomLevel.value;
    return `${Math.round(displayedZoom * 100)}%`;
  });

  /** 当前是否处于 fit 模式 */
  const isFitZoom = computed(() => zoomMode.value === 'fit');

  function getDisplayedZoomLevel(): number {
    return zoomMode.value === 'fit' ? fitZoomLevel.value : zoomLevel.value;
  }

  // ─── Actions ───

  function toggleOutline() {
    outlineCollapsed.value = !outlineCollapsed.value;
  }

  function setInspectorTab(tab: InspectorTab) {
    inspectorTab.value = tab;
    if (!inspectorVisible.value) {
      inspectorVisible.value = true;
    }
  }

  function toggleInspector() {
    inspectorVisible.value = !inspectorVisible.value;
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

  function resetZoom() {
    zoomMode.value = 'fit';
  }

  /** 同步 fit 模式下的缩放显示值，不污染手动缩放状态 */
  function syncFitZoomLevel(level: number) {
    const nextLevel = Math.max(ZOOM_MIN, Math.min(level, ZOOM_MAX));
    if (Math.round(nextLevel * 100) === Math.round(fitZoomLevel.value * 100)) {
      return;
    }
    fitZoomLevel.value = nextLevel;
  }

  /** 切回 fit 模式 */
  function zoomToFit() {
    zoomMode.value = 'fit';
  }

  function selectElement(elementId: string | null) {
    selectedElementId.value = elementId;
  }

  function toggleLayoutWarnings() {
    showLayoutWarnings.value = !showLayoutWarnings.value;
  }

  function setSourceSelectionModeEnabled(enabled: boolean) {
    sourceSelectionModeEnabled.value = enabled;
  }

  function toggleSourceSelectionMode() {
    sourceSelectionModeEnabled.value = !sourceSelectionModeEnabled.value;
  }

  function $reset() {
    outlineCollapsed.value = false;
    inspectorTab.value = 'overview';
    inspectorVisible.value = false;
    zoomMode.value = 'fit';
    zoomLevel.value = ZOOM_DEFAULT;
    /**
     * fitZoomLevel 是当前舞台视口推导值，不是 deck 私有状态。
     * deck 切换时保留上一帧结果，避免缩放栏短暂回落到 100% 再被新舞台回填。
     */
    selectedElementId.value = null;
    showLayoutWarnings.value = false;
    sourceSelectionModeEnabled.value = false;
  }

  return {
    // State
    outlineCollapsed,
    inspectorTab,
    inspectorVisible,
    zoomLevel,
    fitZoomLevel,
    zoomMode,
    selectedElementId,
    showLayoutWarnings,
    sourceSelectionModeEnabled,
    // Computed
    zoomPercentText,
    isFitZoom,
    // Actions
    toggleOutline,
    setInspectorTab,
    toggleInspector,
    zoomIn,
    zoomOut,
    setZoom,
    resetZoom,
    syncFitZoomLevel,
    zoomToFit,
    selectElement,
    toggleLayoutWarnings,
    setSourceSelectionModeEnabled,
    toggleSourceSelectionMode,
    $reset,
  };
});
