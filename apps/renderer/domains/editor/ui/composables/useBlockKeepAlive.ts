import { computed, inject, provide, reactive, type ComputedRef, type InjectionKey } from 'vue';

/**
 * 子 block 端使用的 API：注册/注销保活原因
 *
 * 多个子组件可以各自独立注册不同的保活原因（如 'audio-recording'、'menu-open'），
 * 任一原因存在即保持块激活。
 */
export interface BlockKeepAliveApi {
  register(reason: string): void;
  unregister(reason: string): void;
}

export const BLOCK_KEEP_ALIVE_KEY: InjectionKey<BlockKeepAliveApi> = Symbol('BLOCK_KEEP_ALIVE_KEY');

/**
 * BlockView 端调用：创建保活状态并通过 provide 提供给子组件。
 * 返回 isKeepAlive computed，传给 useBlockActivation 作为强制保活信号。
 */
export function provideBlockKeepAlive(): { isKeepAlive: ComputedRef<boolean> } {
  const activeReasons = reactive(new Set<string>());

  const api: BlockKeepAliveApi = {
    register(reason: string) {
      activeReasons.add(reason);
    },
    unregister(reason: string) {
      activeReasons.delete(reason);
    },
  };

  provide(BLOCK_KEEP_ALIVE_KEY, api);

  const isKeepAlive = computed(() => activeReasons.size > 0);
  return { isKeepAlive };
}

/**
 * 子 block 端调用：注入保活 API。
 * 在 BlockView 外部使用时返回 null。
 */
export function useBlockKeepAlive(): BlockKeepAliveApi | null {
  return inject(BLOCK_KEEP_ALIVE_KEY, null);
}
