import { describe, expect, it } from 'vitest';
import { getKbNameById } from './utils.js';

describe('getKbNameById', () => {
  it('uses the injected fallback label when knowledge base is missing', () => {
    expect(getKbNameById([], 'missing', 'Unknown KB')).toBe('Unknown KB');
  });

  it('returns the knowledge base name when found', () => {
    expect(getKbNameById([{ id: 'kb-1', name: 'Product Docs' }], 'kb-1', 'Unknown KB')).toBe('Product Docs');
  });
});
