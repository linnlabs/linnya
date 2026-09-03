import { describe, expect, it, vi } from 'vitest'
import { createShellPendingProjectionQueue } from './createShellPendingProjectionQueue'

describe('createShellPendingProjectionQueue', () => {
  it('runs a requested rerun after the active projection settles', async () => {
    const queue = createShellPendingProjectionQueue()
    const onRerunRequested = vi.fn()
    let resolveTask = (): void => {
      throw new Error('task resolver was not initialized')
    }
    const task = new Promise<void>((resolve) => {
      resolveTask = resolve
    })

    expect(queue.run(() => task, onRerunRequested)).toBe(true)
    queue.requestRerun()
    resolveTask()
    await Promise.resolve()

    expect(queue.isRunning()).toBe(false)
    expect(onRerunRequested).toHaveBeenCalledTimes(1)
  })

  it('does not rerun a disposed projection after reset', async () => {
    const queue = createShellPendingProjectionQueue()
    const onRerunRequested = vi.fn()
    let resolveTask = (): void => {
      throw new Error('task resolver was not initialized')
    }
    const task = new Promise<void>((resolve) => {
      resolveTask = resolve
    })

    expect(queue.run(() => task, onRerunRequested)).toBe(true)
    queue.requestRerun()
    queue.reset()
    resolveTask()
    await Promise.resolve()

    expect(queue.isRunning()).toBe(false)
    expect(onRerunRequested).not.toHaveBeenCalled()
  })
})
