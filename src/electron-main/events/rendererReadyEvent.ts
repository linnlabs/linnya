/**
 * @file src/electron-main/events/rendererReadyEvent.ts
 *
 * @description
 * 渲染进程 ready 的主进程事件边界。
 *
 * 为什么放在这里：
 * - `renderer-ready` 是 Electron shell 的生命周期信号，不属于模型、更新或任一业务服务；
 * - 事件只属于 Electron Main，不允许 App Server 直接订阅 Electron 生命周期；
 * - 这里只暴露 ready 事件本身，业务域需要补发/同步时自行订阅，避免 shell 侧
 *   直接依赖具体业务实现。
 */

export interface RendererReadyTarget {
  send(channel: string, payload: unknown): void;
  isDestroyed?: () => boolean;
}

export type RendererReadyListener = (target: RendererReadyTarget) => void;

const listeners = new Set<RendererReadyListener>();
let latestTarget: RendererReadyTarget | null = null;

function isTargetUsable(target: RendererReadyTarget | null): target is RendererReadyTarget {
  return Boolean(target && (!target.isDestroyed || !target.isDestroyed()));
}

export function publishRendererReady(target: RendererReadyTarget): number {
  latestTarget = target;

  for (const listener of listeners) {
    listener(target);
  }

  return listeners.size;
}

export function subscribeRendererReady(listener: RendererReadyListener): () => void {
  listeners.add(listener);

  // 如果 renderer 已经 ready，晚订阅者也应立即拿到最新发送目标。
  // 这不是补业务数据，只是补生命周期信号，具体动作仍由订阅方自行决定。
  if (isTargetUsable(latestTarget)) {
    listener(latestTarget);
  }

  return () => {
    listeners.delete(listener);
  };
}

export function clearRendererReadyEventForTesting(): void {
  listeners.clear();
  latestTarget = null;
}
