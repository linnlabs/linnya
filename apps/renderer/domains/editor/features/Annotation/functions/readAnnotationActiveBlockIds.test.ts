import { describe, expect, it } from 'vitest'
import { readAnnotationActiveBlockIds } from './readAnnotationActiveBlockIds'

describe('readAnnotationActiveBlockIds', () => {
  it('returns unique block ids for creating and editing annotations', () => {
    expect(readAnnotationActiveBlockIds([
      { blockId: 'block-a', state: 'confirmed' },
      { blockId: 'block-b', state: 'creating' },
      { blockId: 'block-b', state: 'editing' },
      { blockId: 'block-c', state: 'editing' },
      { blockId: '   ', state: 'creating' },
      { blockId: 'block-d', state: 'resolved' },
    ])).toEqual(['block-b', 'block-c'])
  })
})
