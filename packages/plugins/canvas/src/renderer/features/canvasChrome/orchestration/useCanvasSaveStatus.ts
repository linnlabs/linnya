import { onScopeDispose, ref, watch, type Ref } from 'vue';

export type CanvasSaveStatus = 'saved' | 'saving' | 'failed';

/** 短暂保存不闪字：忙碌超过这个时长才显示“正在保存”，与 Slides 编辑命令条一致。 */
export const CANVAS_SAVE_STATUS_DELAY_MS = 500;

/** 平时停在“已保存”；保存超过阈值才显示“正在保存”，未保存的修改立即显示。 */
export function useCanvasSaveStatus(
  saving: Readonly<Ref<boolean>>,
  unsaved: Readonly<Ref<boolean>>
): Readonly<Ref<CanvasSaveStatus>> {
  const shown = ref<CanvasSaveStatus>(unsaved.value ? 'failed' : 'saved');
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clear = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  watch(
    [saving, unsaved],
    ([busy, failed]) => {
      if (failed) {
        clear();
        shown.value = 'failed';
      } else if (!busy) {
        clear();
        shown.value = 'saved';
      } else if (timer === null && shown.value !== 'saving') {
        timer = setTimeout(() => {
          timer = null;
          if (saving.value && !unsaved.value) shown.value = 'saving';
        }, CANVAS_SAVE_STATUS_DELAY_MS);
      }
    },
    { immediate: true }
  );
  onScopeDispose(clear);
  return shown;
}
