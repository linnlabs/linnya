import { shallowReadonly, shallowRef } from 'vue';
import type { CanvasCardId } from '@plugin/canvas/shared';

export interface CanvasSectionTitleDraft {
  readonly id: CanvasCardId;
  readonly value: string;
}
/** 同一时刻最多一个分区标题处于就地编辑。 */
export function createCanvasSectionTitleState() {
  const draft = shallowRef<CanvasSectionTitleDraft | null>(null);
  return {
    draft: shallowReadonly(draft),
    begin(id: CanvasCardId, value: string) {
      draft.value = { id, value };
    },
    update(value: string) {
      if (draft.value) draft.value = { ...draft.value, value };
    },
    end() {
      draft.value = null;
    },
  };
}
