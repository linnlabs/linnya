import { shallowRef, watch, type Ref } from 'vue';

/**
 * 看板上卡片的乐观挪动：松手后先在界面上放到目标列，写入和补读完成前一直保留。
 * 每次挪动返回一个释放函数，由发起方在确认结果（写入失败，或补读到新值）后调用；
 * 只撤掉自己放下的那一次，同一张卡片之后又被挪动时，先前那次的释放不会误伤。
 * 其他文档的变化不会清掉别的卡片的挪动；换项目时全部清空。
 */
export function useProjectOverviewBoardOverrides(projectId: Readonly<Ref<string | null>>) {
  const overrides = shallowRef<ReadonlyMap<string, string | null>>(new Map());
  const placements = new Map<string, number>();
  let sequence = 0;

  function place(documentId: string, optionId: string | null): () => void {
    sequence += 1;
    const placement = sequence;
    placements.set(documentId, placement);
    overrides.value = new Map([...overrides.value, [documentId, optionId]]);
    return () => {
      if (placements.get(documentId) !== placement) return;
      placements.delete(documentId);
      const next = new Map(overrides.value);
      next.delete(documentId);
      overrides.value = next;
    };
  }

  watch(projectId, () => {
    placements.clear();
    overrides.value = new Map();
  });

  return { overrides, place };
}
