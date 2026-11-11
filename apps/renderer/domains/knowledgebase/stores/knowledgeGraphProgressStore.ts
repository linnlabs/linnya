import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { KbGraphProgress } from '../features/graph-progress/definitions/kbGraphProgress';
export type { KbGraphProgress } from '../features/graph-progress/definitions/kbGraphProgress';

/** 只持有图谱进度事实；订阅和 30 秒预取窗口属于 graph-progress 运行编排。 */
export const useKnowledgeGraphProgressStore = defineStore('knowledgeGraphProgress', () => {
  const progressByKbId = ref<Record<string, KbGraphProgress>>({});
  const percentByKbId = computed(() => {
    const out: Record<string, number> = {};
    for (const [kbId, progress] of Object.entries(progressByKbId.value)) out[kbId] = progress.percent;
    return out;
  });
  function setProgress(progress: KbGraphProgress): void {
    progressByKbId.value = { ...progressByKbId.value, [progress.kbId]: progress };
  }
  function getProgress(kbId: string): KbGraphProgress | null {
    const id = typeof kbId === 'string' ? kbId.trim() : '';
    return id ? progressByKbId.value[id] ?? null : null;
  }
  return { progressByKbId, percentByKbId, setProgress, getProgress };
});
