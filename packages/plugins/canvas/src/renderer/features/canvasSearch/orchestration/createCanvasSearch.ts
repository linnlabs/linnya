import { computed } from 'vue';
import {
  searchCanvasElements,
  type CanvasElementId,
  type CanvasSearchContext,
} from '@plugin/canvas/shared';
import type { CanvasDocumentSession } from '../../canvasDocument';
import { createCanvasSearchState } from '../store/createCanvasSearchState';
export function createCanvasSearch(
  session: CanvasDocumentSession,
  /** 文档标题与卡片标签名；标签可按“#名称”搜到。 */
  readContext: () => CanvasSearchContext,
  locate: (ids: readonly CanvasElementId[]) => void
) {
  const state = createCanvasSearchState();
  const hits = computed(() =>
    searchCanvasElements(
      session.state.snapshot.value?.elements ?? [],
      state.query.value,
      readContext()
    )
  );
  return {
    state,
    hits,
    navigate(step: number) {
      if (!hits.value.length) return;
      const index = (state.index.value + step + hits.value.length) % hits.value.length;
      state.select(index);
      const hit = hits.value[index];
      if (hit) locate([hit.id]);
    },
    jump(index: number) {
      state.select(index);
      const hit = hits.value[index];
      if (hit) locate([hit.id]);
    },
  };
}
