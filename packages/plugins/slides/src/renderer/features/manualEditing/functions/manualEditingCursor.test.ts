import { describe, expect, it } from 'vitest';
import { resolveManualEditingCursor } from './manualEditingCursor';

describe('manual editing cursor', () => {
  it('does not advertise movement over the slide background', () => {
    expect(resolveManualEditingCursor(null)).toBe('default');
  });

  it('distinguishes movable and selectable-only author targets', () => {
    expect(resolveManualEditingCursor({ capabilities: ['translate'] })).toBe('move');
    expect(resolveManualEditingCursor({ capabilities: ['delete'] })).toBe('pointer');
  });
});
