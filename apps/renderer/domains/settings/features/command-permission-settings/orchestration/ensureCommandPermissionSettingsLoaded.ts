import type { CommandPermissionSettingsGateway } from '../infrastructure/commandPermissionSettingsGateway';
import { commandPermissionSettingsGateway } from '../infrastructure/commandPermissionSettingsGateway';
import { projectCommandPermissionSettings } from '../definitions/commandPermissionSettingsProjection';
import { useCommandPermissionSettingsStore } from '../store/commandPermissionSettingsStore';

const pendingLoads = new WeakMap<object, Promise<void>>();

/**
 * 同一 renderer owner 只读取一次后端事实，并复用进行中的请求。设置页和输入框会同时
 * 消费这份状态，因此重复挂载不能把设置页尚未提交的 draft 重置掉。
 */
export async function ensureCommandPermissionSettingsLoaded(
  gateway: CommandPermissionSettingsGateway = commandPermissionSettingsGateway,
): Promise<void> {
  const store = useCommandPermissionSettingsStore();
  if (store.loadState === 'ready') return;

  const existing = pendingLoads.get(store);
  if (existing) return existing;

  const pending = (async () => {
    store.beginLoad();
    try {
      const result = await gateway.read();
      if (!result.success) {
        store.loadFailed();
        return;
      }

      store.loadSucceeded(projectCommandPermissionSettings(result.settings));
    } catch {
      store.loadFailed();
    }
  })().finally(() => {
    pendingLoads.delete(store);
  });

  pendingLoads.set(store, pending);
  return pending;
}
