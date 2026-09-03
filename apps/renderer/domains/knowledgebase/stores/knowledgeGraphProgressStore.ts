/**
 * @file apps/renderer/domains/knowledgebase/stores/knowledgeGraphProgressStore.ts
 *
 * @description
 * 知识图谱构建进度 Store（M6 前置：前端状态层）。
 *
 * 设计要点：
 * - 分为“全局态”：kbId -> progress 映射（列表页/详情页共用）
 * - “单 KB”只是从映射里按 kbId 取值（低耦合）
 * - Electron 环境通过 preload IPC 拉取 + 订阅推送；Web 环境暂不启用（返回 null）
 */
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { knowledgeBaseService } from '../services/knowledgeBaseService';

export type KbGraphProgress = {
  kbId: string;
  percent: number;
  totalUnits: number;
  doneUnits: number;
  updatedAtSeconds: number | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function coerceKbGraphProgress(payload: unknown): KbGraphProgress | null {
  if (!isRecord(payload)) return null;
  const kbId = typeof payload.kbId === 'string' ? payload.kbId : '';
  const percent = typeof payload.percent === 'number' ? payload.percent : null;
  const totalUnits = typeof payload.totalUnits === 'number' ? payload.totalUnits : null;
  const doneUnits = typeof payload.doneUnits === 'number' ? payload.doneUnits : null;
  const updatedAtSeconds =
    payload.updatedAtSeconds === null || typeof payload.updatedAtSeconds === 'number'
      ? (payload.updatedAtSeconds as number | null)
      : null;

  if (kbId.trim().length === 0) return null;
  if (percent === null || totalUnits === null || doneUnits === null) return null;

  return {
    kbId,
    percent: Math.max(0, Math.min(100, Math.round(percent))),
    totalUnits: Math.max(0, Math.trunc(totalUnits)),
    doneUnits: Math.max(0, Math.trunc(doneUnits)),
    updatedAtSeconds,
  };
}

export const useKnowledgeGraphProgressStore = defineStore('knowledgeGraphProgress', () => {
  /**
   * kbId -> progress（全局映射）
   *
   * 说明：用普通对象而不是 Map，便于响应式更新（替换对象触发更新）。
   */
  const progressByKbId = ref<Record<string, KbGraphProgress>>({});
  const lastFetchedAtMsByKbId = ref<Record<string, number>>({});

  // 订阅只初始化一次
  const isSubscribed = ref(false);
  const unsubscribe = ref<null | (() => void)>(null);

  const getProgress = (kbId: string): KbGraphProgress | null => {
    const id = typeof kbId === 'string' ? kbId.trim() : '';
    if (!id) return null;
    return progressByKbId.value[id] ?? null;
  };

  const percentByKbId = computed(() => {
    const out: Record<string, number> = {};
    for (const [kbId, p] of Object.entries(progressByKbId.value)) {
      out[kbId] = p.percent;
    }
    return out;
  });

  /**
   * 建立全局订阅（Electron 环境）。
   */
  const ensureSubscribed = () => {
    if (isSubscribed.value) return;
    const unsub = knowledgeBaseService.onKbGraphProgressUpdated((payload: unknown) => {
      const p = coerceKbGraphProgress(payload);
      if (!p) return;
      progressByKbId.value = { ...progressByKbId.value, [p.kbId]: p };
    });
    unsubscribe.value = typeof unsub === 'function' ? unsub : null;
    isSubscribed.value = true;
  };

  /**
   * 拉取单个 KB 的最新进度。
   */
  const fetchKbProgress = async (kbId: string): Promise<KbGraphProgress | null> => {
    const id = typeof kbId === 'string' ? kbId.trim() : '';
    if (!id) return null;

    const raw = await knowledgeBaseService.getKbGraphProgress(id);
    const p = coerceKbGraphProgress(raw);
    if (!p) return null;

    progressByKbId.value = { ...progressByKbId.value, [p.kbId]: p };
    lastFetchedAtMsByKbId.value = { ...lastFetchedAtMsByKbId.value, [p.kbId]: Date.now() };
    return p;
  };

  /**
   * 批量预取（用于“全局列表页”展示）。
   * - 默认 30s 内不重复拉取同一个 kbId（避免频繁 IPC）。
   */
  const prefetchForKbIds = async (kbIds: string[]): Promise<void> => {
    if (!Array.isArray(kbIds) || kbIds.length === 0) return;
    const now = Date.now();
    const unique = Array.from(new Set(kbIds.map((x) => (typeof x === 'string' ? x.trim() : '')).filter((x) => x.length > 0)));
    for (const id of unique) {
      const last = lastFetchedAtMsByKbId.value[id] ?? 0;
      if (now - last < 30_000) continue;
      await fetchKbProgress(id);
    }
  };

  const cleanup = () => {
    if (unsubscribe.value) {
      unsubscribe.value();
      unsubscribe.value = null;
    }
    isSubscribed.value = false;
  };

  return {
    // state
    progressByKbId,
    percentByKbId,

    // getters
    getProgress,

    // actions
    ensureSubscribed,
    fetchKbProgress,
    prefetchForKbIds,
    cleanup,
  };
});


