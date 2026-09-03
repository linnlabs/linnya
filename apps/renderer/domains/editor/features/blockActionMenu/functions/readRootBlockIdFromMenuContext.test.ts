import { describe, expect, it } from 'vitest';
import { readRootBlockIdFromMenuContext } from './readRootBlockIdFromMenuContext';

describe('readRootBlockIdFromMenuContext', () => {
  it('reads a valid rootBlock id from block action menu context', () => {
    expect(readRootBlockIdFromMenuContext({
      rootBlockNode: {
        attrs: {
          id: 'block-a',
        },
      },
    })).toBe('block-a');
  });

  it('ignores missing or non-string rootBlock ids', () => {
    expect(readRootBlockIdFromMenuContext(null)).toBeNull();
    expect(readRootBlockIdFromMenuContext({
      rootBlockNode: {
        attrs: {},
      },
    })).toBeNull();
    expect(readRootBlockIdFromMenuContext({
      rootBlockNode: {
        attrs: {
          id: 123,
        },
      },
    })).toBeNull();
  });
});
