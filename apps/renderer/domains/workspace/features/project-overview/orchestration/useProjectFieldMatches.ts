import { ref, shallowRef, watch, type Ref } from 'vue';
import type { ProjectFieldCondition } from '@app/schemas';
import { matchProjectFields } from '../infrastructure/projectOverviewGateway';

/**
 * 字段条件由 Backend 的查询编译器求值，与 `linnya query` 同一套含义。
 * 文档有变化（revision）时重算；没有字段条件时为 null，表示不按字段筛。
 */
export function useProjectFieldMatches(
  projectId: Readonly<Ref<string | null>>,
  where: Readonly<Ref<readonly ProjectFieldCondition[]>>,
  revision: Readonly<Ref<number>>,
) {
  const matches = shallowRef<ReadonlySet<string> | null>(null);
  const failure = ref<string | null>(null);
  let sequence = 0;
  let lastKey = '';

  watch([projectId, () => JSON.stringify(where.value), revision], async ([target, key]) => {
    const current = ++sequence;
    failure.value = null;
    if (!target || where.value.length === 0) {
      matches.value = null;
      lastKey = '';
      return;
    }
    // 条件换了时先清空，避免短暂显示上一组条件的结果；只是文档刷新时保留旧结果。
    if (key !== lastKey) matches.value = new Set();
    lastKey = key;
    try {
      const result = await matchProjectFields({ project_id: target, where: [...where.value] });
      if (current !== sequence) return;
      if (result.ok) matches.value = new Set(result.document_ids);
      else {
        matches.value = new Set();
        failure.value = result.message;
      }
    } catch (error: unknown) {
      if (current !== sequence) return;
      console.error('[ProjectOverview] 字段条件求值失败:', error);
      matches.value = new Set();
      failure.value = error instanceof Error ? error.message : String(error);
    }
  }, { immediate: true });

  return { matches, failure };
}
