import { describe, expect, it } from 'vitest';
import { isSlidesAuthoringEditProjection } from './authoringEditProjection';

describe('authoring edit projection', () => {
  it('accepts explicit plain text authoring facts independently of render runs', () => {
    expect(isSlidesAuthoringEditProjection({
      capabilities: ['translate', 'set_text_content'],
      text: { kind: 'plain_text', content: '增长 2026\n下一行' },
    })).toBe(true);
  });

  it('keeps rich text read-only and rejects inconsistent capabilities', () => {
    expect(isSlidesAuthoringEditProjection({
      capabilities: ['translate'],
      text: { kind: 'rich_text' },
    })).toBe(true);
    expect(isSlidesAuthoringEditProjection({
      capabilities: ['translate', 'set_text_content'],
      text: { kind: 'rich_text' },
    })).toBe(false);
  });

  it('accepts an unavailable frame without writable capabilities', () => {
    expect(isSlidesAuthoringEditProjection({
      capabilities: [],
      unavailableReason: 'frame_members_unavailable',
    })).toBe(true);
  });

  it('rejects empty available projections and text-only interaction sets', () => {
    expect(isSlidesAuthoringEditProjection({ capabilities: [] })).toBe(false);
    expect(isSlidesAuthoringEditProjection({
      capabilities: ['set_text_content'],
      text: { kind: 'plain_text', content: 'Copy' },
    })).toBe(false);
  });
});
