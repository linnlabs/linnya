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
