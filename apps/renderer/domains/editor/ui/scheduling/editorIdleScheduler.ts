/**
 * editorIdleScheduler.ts
 *
 * Editor UI 的空闲/下一帧调度边界。
 *
 * 中文说明：
 * - 业务代码不直接嗅探 requestIdleCallback / requestAnimationFrame；
 * - 首选 idle，让首屏和滚动先完成绘制；没有 idle API 时退回下一帧；
 * - 返回统一 cancel 句柄，调用方只表达“低优先级任务”这个意图。
 */

export interface EditorIdleDeadline {
  didTimeout: boolean
  timeRemaining: () => number
}

export interface EditorScheduledTask {
  kind: 'frame' | 'idle'
  cancel: () => void
}

interface BrowserIdleScheduler {
  requestIdleCallback?: (
    callback: (deadline: EditorIdleDeadline) => void,
    options?: { timeout: number }
  ) => number
  cancelIdleCallback?: (handle: number) => void
}

function readBrowserIdleScheduler(): BrowserIdleScheduler {
  return globalThis
}

export function scheduleEditorIdleTask(
  callback: () => void,
  options: {
    timeoutMs: number
  }
): EditorScheduledTask {
  const idleScheduler = readBrowserIdleScheduler()
  if (typeof idleScheduler.requestIdleCallback === 'function') {
    const handle = idleScheduler.requestIdleCallback(callback, {
      timeout: options.timeoutMs,
    })
    return {
      kind: 'idle',
      cancel: () => {
        idleScheduler.cancelIdleCallback?.(handle)
      },
    }
  }

  const handle = requestAnimationFrame(() => {
    callback()
  })
  return {
    kind: 'frame',
    cancel: () => {
      cancelAnimationFrame(handle)
    },
  }
}

export function scheduleEditorFrameTask(callback: () => void): EditorScheduledTask {
  const handle = requestAnimationFrame(() => {
    callback()
  })
  return {
    kind: 'frame',
    cancel: () => {
      cancelAnimationFrame(handle)
    },
  }
}
