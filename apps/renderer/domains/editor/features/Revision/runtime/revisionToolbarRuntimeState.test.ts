import { describe, expect, it } from 'vitest'
import {
  getRevisionToolbarRuntimeSnapshot,
  publishRevisionToolbarBlockIds,
  resetRevisionToolbarRuntimeState,
  subscribeRevisionToolbarRuntimeState,
} from './revisionToolbarRuntimeState'

describe('revisionToolbarRuntimeState', () => {
  it('normalizes toolbar block ids and notifies subscribers', () => {
    resetRevisionToolbarRuntimeState()
    const snapshots: string[][] = []
    const unsubscribe = subscribeRevisionToolbarRuntimeState((snapshot) => {
      snapshots.push([...snapshot.toolbarBlockIds])
    })

    publishRevisionToolbarBlockIds(['block-a', ' ', 'block-a', 'block-b'])

    expect(getRevisionToolbarRuntimeSnapshot().toolbarBlockIds).toEqual(['block-a', 'block-b'])
    expect(snapshots).toEqual([['block-a', 'block-b']])

    unsubscribe()
  })
})
