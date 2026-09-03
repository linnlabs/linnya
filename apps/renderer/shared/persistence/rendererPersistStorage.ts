import type { StorageLike } from 'pinia-plugin-persistedstate';

interface RendererPersistStorage extends StorageLike {
  removeItem(key: string): void;
}

function createMemoryPersistStorage(): RendererPersistStorage {
  const values = new Map<string, string>();

  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    },
  };
}

let resolvedStorage: RendererPersistStorage | null = null;

export function getRendererPersistStorage(): RendererPersistStorage {
  if (resolvedStorage) {
    return resolvedStorage;
  }

  const browserStorage = globalThis.localStorage;

  // Pinia 的持久化配置会在 store 模块加载时求值；Node 单测没有 localStorage。
  // 这里把“运行环境适配”隔离在 renderer 基础设施层，业务 store 只声明自己需要持久化。
  resolvedStorage = browserStorage ?? createMemoryPersistStorage();
  return resolvedStorage;
}
