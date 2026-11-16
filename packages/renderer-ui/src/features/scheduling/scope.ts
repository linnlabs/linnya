import { onScopeDispose } from 'vue';

/**
 * `use…` 版本把取消挂到当前组件（或 store 等 effect scope）上，卸载时自动执行。
 * 只在 setup 里调用；没有活动 scope 时 Vue 会在开发模式下警告。
 * `create…` 版本不做任何绑定，由调用方在自己的收尾里取消，避免全局编排被某个组件的卸载意外取消。
 */
export function cancelOnScopeDispose<T>(scheduler: T, cancel: () => void): T {
  onScopeDispose(cancel);
  return scheduler;
}
