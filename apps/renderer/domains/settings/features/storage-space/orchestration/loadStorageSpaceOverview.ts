import type { StorageSpaceGateway } from '../definitions/storageSpaceGateway';
import { storageSpaceGateway } from '../infrastructure/storageSpaceGateway';
import { useStorageSpaceStore } from '../store/storageSpaceStore';

const pendingLoads = new WeakMap<object, Promise<boolean>>();

async function startLoad(gateway: StorageSpaceGateway): Promise<boolean> {
  const store = useStorageSpaceStore();
  const pending = (async () => {
    store.beginLoad();
    try {
      store.loadSucceeded(await gateway.readOverview());
      return true;
    } catch {
      store.loadFailed();
      return false;
    }
  })().finally(() => {
    pendingLoads.delete(store);
  });
  pendingLoads.set(store, pending);
  return pending;
}

/** 首次进入和手动刷新共用同一读取流程；同一 renderer owner 的并发读取只发一次请求。 */
export async function loadStorageSpaceOverview(
  gateway: StorageSpaceGateway = storageSpaceGateway,
): Promise<boolean> {
  const store = useStorageSpaceStore();
  return pendingLoads.get(store) ?? startLoad(gateway);
}

/**
 * 清理成功后的读取必须发生在 DELETE 204 之后。若用户恰好正在手动刷新，先等旧读取结束，
 * 再开始一次新读取，不能复用可能包含清理前事实的请求。
 */
export function reloadStorageSpaceOverviewAfterClear(
  gateway: StorageSpaceGateway = storageSpaceGateway,
): Promise<boolean> {
  const store = useStorageSpaceStore();
  const pending = pendingLoads.get(store);
  if (!pending) return startLoad(gateway);

  // 不同对话可以并发删除，但删除后的概览读取必须排队。否则两个 204 几乎同时返回时，
  // 较早启动的旧快照可能最后完成并覆盖较新的存储事实。
  return pending.then(() => reloadStorageSpaceOverviewAfterClear(gateway));
}
