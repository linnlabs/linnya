import { describe, expect, it } from 'vitest'
import type { BlockHistoryUiState } from '../store/useBlockHistoryStore'
import { readHistoryModeBlockIds } from './readHistoryModeBlockIds'

function state(mode: BlockHistoryUiState['mode']): BlockHistoryUiState {
  return {
    mode,
    isLoading: false,
  }
}

describe('readHistoryModeBlockIds', () => {
  it('returns only blocks whose history mode is active', () => {
    expect(readHistoryModeBlockIds({
      'block-a': state('none'),
      'block-b': state('overlay'),
      'block-c': state('side-by-side'),
      '': state('multi-column'),
    })).toEqual(['block-b', 'block-c'])
  })
})
