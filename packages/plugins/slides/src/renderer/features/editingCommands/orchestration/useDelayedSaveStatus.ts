import { onScopeDispose, ref, watch, type Ref } from 'vue';
import type { EditingCommandMessageKey } from '../definitions/editingCommandMessages';

const BUSY_STATUSES = new Set<EditingCommandMessageKey>([
  'slides.editingCommands.editing', 'slides.editingCommands.saving', 'slides.editingCommands.refreshing',
]);
/** 短暂保存不闪字：忙碌超过这个时长才显示“保存中”。 */
export const SAVE_STATUS_DELAY_MS = 500;

/** 平时停在“已保存”；编辑、保存、刷新合成一个延迟出现的“保存中”，失败立即显示。 */
export function useDelayedSaveStatus(status: Readonly<Ref<EditingCommandMessageKey>>): Readonly<Ref<EditingCommandMessageKey>> {
  const shown = ref<EditingCommandMessageKey>(BUSY_STATUSES.has(status.value) ? 'slides.editingCommands.saved' : status.value);
  let timer: ReturnType<typeof setTimeout> | null = null;
  function clear(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }
  watch(status, next => {
    if (!BUSY_STATUSES.has(next)) {
      clear();
      shown.value = next;
    } else if (timer === null && shown.value !== 'slides.editingCommands.saving') {
      timer = setTimeout(() => {
        timer = null;
        if (BUSY_STATUSES.has(status.value)) shown.value = 'slides.editingCommands.saving';
      }, SAVE_STATUS_DELAY_MS);
    }
  });
  onScopeDispose(clear);
  return shown;
}
