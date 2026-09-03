/**
 * Slides 流程态
 *
 * 跟踪当前正在进行的操作：生成/inspect/repair 等。
 * 独立于领域事实状态和 UI 状态，避免一个 store 管所有事情。
 */

import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useSlidesSessionStore = defineStore('slides-session', () => {
  // ─── State ───

  /** 是否正在生成新的演示文稿 */
  const isGenerating = ref(false);

  /** 是否正在执行 inspect */
  const isInspecting = ref(false);

  /** 是否正在执行 repair */
  const isRepairing = ref(false);

  /** 最近一次 diagnostics 刷新时间 */
  const lastDiagnosticsRefresh = ref<number | null>(null);

  // ─── Actions ───

  function startGenerating() { isGenerating.value = true; }
  function stopGenerating() { isGenerating.value = false; }

  function startInspecting() { isInspecting.value = true; }
  function stopInspecting() { isInspecting.value = false; }

  function startRepairing() { isRepairing.value = true; }
  function stopRepairing() { isRepairing.value = false; }

  function markDiagnosticsRefreshed() {
    lastDiagnosticsRefresh.value = Date.now();
  }

  function $reset() {
    isGenerating.value = false;
    isInspecting.value = false;
    isRepairing.value = false;
    lastDiagnosticsRefresh.value = null;
  }

  return {
    // State
    isGenerating,
    isInspecting,
    isRepairing,
    lastDiagnosticsRefresh,
    // Actions
    startGenerating,
    stopGenerating,
    startInspecting,
    stopInspecting,
    startRepairing,
    stopRepairing,
    markDiagnosticsRefreshed,
    $reset,
  };
});
