/**
 * Shell pending 投影串行队列。
 *
 * 中文说明：
 * - pending 投影会写入 ProseMirror 文档，不能并发执行；
 * - 滚动期间如果新窗口到达，只记录“需要再跑一次”，本轮结束后读取最新窗口；
 * - 这里集中维护 in-flight / rerun 语义，避免 bridge 主流程散落布尔锁。
 */

export interface ShellPendingProjectionQueue {
  readonly isRunning: () => boolean
  readonly requestRerun: () => void
  readonly run: (
    task: () => Promise<void>,
    onRerunRequested: () => void
  ) => boolean
  readonly reset: () => void
}

export function createShellPendingProjectionQueue(): ShellPendingProjectionQueue {
  let running = false
  let rerunRequested = false
  let generation = 0

  return {
    isRunning: () => running,
    requestRerun: () => {
      rerunRequested = true
    },
    run: (task, onRerunRequested) => {
      if (running) {
        rerunRequested = true
        return false
      }

      running = true
      const runGeneration = generation
      void task().finally(() => {
        if (runGeneration !== generation) return

        running = false
        if (!rerunRequested) return

        rerunRequested = false
        onRerunRequested()
      })
      return true
    },
    reset: () => {
      generation += 1
      running = false
      rerunRequested = false
    },
  }
}
