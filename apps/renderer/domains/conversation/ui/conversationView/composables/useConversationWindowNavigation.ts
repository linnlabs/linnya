import { readonly, ref } from 'vue';

/** 时间轴与回到底部共用同一导航代次；加载到布局落定期间暂停双向自动分页。 */
export function useConversationWindowNavigation() {
  const isNavigating = ref(false);
  let active: AbortController | null = null;

  const cancel = (): void => {
    active?.abort();
    active = null;
    isNavigating.value = false;
  };

  const run = async (navigate: (signal: AbortSignal) => Promise<void>): Promise<void> => {
    active?.abort();
    const navigation = new AbortController();
    active = navigation;
    isNavigating.value = true;
    try {
      await navigate(navigation.signal);
    } finally {
      // 被新导航替换的旧任务不得解除新任务的分页锁。
      if (active === navigation) cancel();
    }
  };

  return { isNavigating: readonly(isNavigating), run, cancel };
}
