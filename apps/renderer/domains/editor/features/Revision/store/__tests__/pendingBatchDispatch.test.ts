import { describe, expect, it, vi } from 'vitest'
import type { Editor } from '@tiptap/core'
import type { EditorState } from '@tiptap/pm/state'
import { withBatchedPendingDispatches } from '../pendingBatchDispatch'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: unknown) => void
}

function createDeferred<T>(): Deferred<T> {
  let resolveDeferred: Deferred<T>['resolve'] = () => {}
  let rejectDeferred: Deferred<T>['reject'] = () => {}
  const promise = new Promise<T>((resolve, reject) => {
    resolveDeferred = resolve
    rejectDeferred = reject
  })

  return {
    promise,
    resolve: resolveDeferred,
    reject: rejectDeferred,
  }
}

function createEditor(): { editor: Editor; updateStateSpy: ReturnType<typeof vi.fn> } {
  const state = { label: 'initial' } as unknown as EditorState
  const updateStateSpy = vi.fn()
  const editor = {
    state,
    view: {
      updateState: updateStateSpy,
      _state: state,
      _props: { state },
    },
  } as unknown as Editor
  return { editor, updateStateSpy }
}

describe('withBatchedPendingDispatches', () => {
  it('serializes pending batches for the same editor', async () => {
    const { editor, updateStateSpy } = createEditor()
    const firstStarted = createDeferred<void>()
    const firstCanFinish = createDeferred<void>()
    const order: string[] = []

    const first = withBatchedPendingDispatches(editor, async () => {
      order.push('first:start')
      firstStarted.resolve()
      await firstCanFinish.promise
      order.push('first:end')
    })

    await firstStarted.promise

    const second = withBatchedPendingDispatches(editor, async () => {
      order.push('second:start')
    })

    await Promise.resolve()
    expect(order).toEqual(['first:start'])

    firstCanFinish.resolve()
    await Promise.all([first, second])

    expect(order).toEqual(['first:start', 'first:end', 'second:start'])
    expect(updateStateSpy).toHaveBeenCalledTimes(2)
  })

  it('continues the queue when a previous batch fails', async () => {
    const { editor, updateStateSpy } = createEditor()
    const firstStarted = createDeferred<void>()
    const firstCanFail = createDeferred<void>()
    const order: string[] = []

    const first = withBatchedPendingDispatches(editor, async () => {
      order.push('first:start')
      firstStarted.resolve()
      await firstCanFail.promise
      throw new Error('boom')
    })

    await firstStarted.promise

    const second = withBatchedPendingDispatches(editor, async () => {
      order.push('second:start')
    })

    firstCanFail.resolve()
    await expect(first).rejects.toThrow('boom')
    await second

    expect(order).toEqual(['first:start', 'second:start'])
    expect(updateStateSpy).toHaveBeenCalledTimes(2)
  })
})
