import { describe, expect, it } from 'vitest';
import { resolveInsertionPalette } from './resolveInsertionPalette';

describe('resolveInsertionPalette', () => {
  it('uses the deck theme text and accent colors when they read on the slide', () => {
    expect(resolveInsertionPalette({ text: '#1f2937', accent1: '#0EA5E9' }, { paint: { type: 'solid', color: '#FFFFFF' } }))
      .toEqual({ text: '#1F2937', fill: '#0EA5E9' });
  });

  it('switches to a readable text color on a dark slide and falls back without a theme', () => {
    expect(resolveInsertionPalette({ text: '#111827' }, { paint: { type: 'solid', color: '#0B1020' } }).text).toBe('#FFFFFF');
    expect(resolveInsertionPalette(undefined, { paint: { type: 'linear', angle: 0, stops: [{ color: '#111111', position: 0 }] } }))
      .toEqual({ text: '#FFFFFF', fill: '#2563EB' });
  });
});
