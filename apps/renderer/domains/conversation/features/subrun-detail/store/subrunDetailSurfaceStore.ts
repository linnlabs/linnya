import { defineStore, storeToRefs } from 'pinia';
import { readonly, shallowRef, type Ref } from 'vue';

import type { SubrunDetailScope } from '../definitions/subrunDetail';

/**
 * Subrun 详情是 Conversation pane 内唯一的临时子 surface。
 *
 * scope 放在 feature store 中，是因为 ConversationHost 与应用 Header 都需要消费同一份
 * 当前详情身份；它不持久化，也不保存 DOM 返回锚点。返回锚点仍由 Host 导航编排独占。
 */
export const useSubrunDetailSurfaceStore = defineStore('conversationSubrunDetailSurface', () => {
  const scope = shallowRef<SubrunDetailScope | null>(null);
  const returnRequestRevision = shallowRef(0);

  const setScope = (nextScope: SubrunDetailScope): void => {
    scope.value = Object.freeze({ ...nextScope });
  };

  const clearScope = (): void => {
    scope.value = null;
  };

  /**
   * Header 与详情底栏只能表达“返回”意图；真正的 DOM 锚点恢复仍由当前 Host 编排。
   * revision 是一次性信号，不保存 callback，也不会把页面元素塞进全局状态。
   */
  const requestReturnToParent = (): void => {
    if (!scope.value) return;
    returnRequestRevision.value += 1;
  };

  return {
    scope,
    returnRequestRevision,
    setScope,
    clearScope,
    requestReturnToParent,
  };
});

/** 应用 Header 只读取当前详情身份，不能取得 feature store 的写能力。 */
export function useSubrunDetailSurfaceScope(): Readonly<Ref<SubrunDetailScope | null>> {
  const { scope } = storeToRefs(useSubrunDetailSurfaceStore());
  return readonly(scope);
}

/** 应用 Header 只取得窄返回命令，不能直接清理详情身份。 */
export function requestSubrunDetailReturnToParent(): void {
  useSubrunDetailSurfaceStore().requestReturnToParent();
}
