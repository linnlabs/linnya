import { describe, expect, it } from 'vitest'
import { readRevisionToolbarBlockIds } from './readRevisionToolbarBlockIds'

describe('readRevisionToolbarBlockIds', () => {
  it('returns unique block ids whose revision toolbar is visible', () => {
    expect(readRevisionToolbarBlockIds([
      { blockId: 'block-a', showToolbar: false },
      { blockId: 'block-b', showToolbar: true },
      { blockId: 'block-b', showToolbar: true },
      { blockId: ' ', showToolbar: true },
      { blockId: 'block-c', showToolbar: true },
    ])).toEqual(['block-b', 'block-c'])
  })
})
