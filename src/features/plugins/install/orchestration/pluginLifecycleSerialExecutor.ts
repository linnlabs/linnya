import type { PluginId } from '@app/schemas';

export type PluginLifecycleOperation =
  | 'install-from-remote'
  | 'set-enabled'
  | 'uninstall';

export interface RunPluginLifecycleOperationSeriallyOptions<T> {
  readonly pluginId: PluginId;
  readonly operation: PluginLifecycleOperation;
  readonly run: () => Promise<T> | T;
}

interface PluginLifecycleQueueEntry {
  readonly tail: Promise<void>;
  readonly size: number;
}

const queuesByPluginId = new Map<PluginId, PluginLifecycleQueueEntry>();

function toCompletion(promise: Promise<unknown>): Promise<void> {
  return promise.then(
    () => {},
    () => {},
  );
}

export async function runPluginLifecycleOperationSerially<T>(
  options: RunPluginLifecycleOperationSeriallyOptions<T>,
): Promise<T> {
  // 中文说明：这里的模块级队列只负责同一主进程内的生命周期写操作排队，
  // 不保存插件启用/安装状态。真实运行态仍只从 SQLite 读取，避免回到双 bundle 单例问题。
  const previousEntry = queuesByPluginId.get(options.pluginId);
  const previousTail = previousEntry?.tail ?? Promise.resolve();

  let releaseCurrent: () => void = () => {};
  const currentTail = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });

  queuesByPluginId.set(options.pluginId, {
    tail: previousTail.then(() => currentTail),
    size: (previousEntry?.size ?? 0) + 1,
  });

  await previousTail;

  try {
    return await options.run();
  } finally {
    releaseCurrent();
    const currentEntry = queuesByPluginId.get(options.pluginId);
    if (currentEntry) {
      const nextSize = currentEntry.size - 1;
      if (nextSize <= 0) {
        queuesByPluginId.delete(options.pluginId);
      } else {
        queuesByPluginId.set(options.pluginId, {
          tail: toCompletion(currentEntry.tail),
          size: nextSize,
        });
      }
    }
  }
}

export function clearPluginLifecycleSerialExecutorForTests(): void {
  queuesByPluginId.clear();
}
