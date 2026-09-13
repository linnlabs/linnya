import { describe, expect, it } from 'vitest';
import {
  buildSlidesAuthoringRenderNodeId,
  isSlidesAuthoringAncestorRefs,
  isSlidesAuthoringEditRef,
  isSlidesAuthoringObjectRef,
  isSlidesAuthoringKey,
} from './authoringIdentity';

describe('Slides authoring identity', () => {
  it('只接受可读且有界的稳定 key', () => {
    expect(isSlidesAuthoringKey('revenue_chart_2026')).toBe(true);
    expect(isSlidesAuthoringKey('2nd-chart')).toBe(false);
    expect(isSlidesAuthoringKey('title with spaces')).toBe(false);
    expect(isSlidesAuthoringKey(`a${'b'.repeat(64)}`)).toBe(false);
  });

  it('严格接纳完整的 slideKey + editKey 对', () => {
    const ref = { slideKey: 'overview', editKey: 'headline' };
    expect(isSlidesAuthoringEditRef(ref)).toBe(true);
    expect(isSlidesAuthoringEditRef({ ...ref, page: 1 })).toBe(false);
    expect(buildSlidesAuthoringRenderNodeId(ref)).toBe('authoring-overview-headline');
  });

  it('编译产物额外携带不参与 ID 的作者目标类型', () => {
    const ref = { slideKey: 'overview', editKey: 'headline', targetKind: 'text' } as const;
    expect(isSlidesAuthoringObjectRef(ref)).toBe(true);
    expect(isSlidesAuthoringEditRef(ref)).toBe(false);
    expect(buildSlidesAuthoringRenderNodeId(ref)).toBe('authoring-overview-headline');
  });

  it('只接受同页、无重复的 Frame 作者祖先', () => {
    const descendant = {
      slideKey: 'overview', editKey: 'headline', targetKind: 'text',
    } as const;
    expect(isSlidesAuthoringAncestorRefs([
      { slideKey: 'overview', editKey: 'section', targetKind: 'frame' },
      { slideKey: 'overview', editKey: 'card', targetKind: 'frame' },
    ], descendant)).toBe(true);
    expect(isSlidesAuthoringAncestorRefs([
      { slideKey: 'other', editKey: 'card', targetKind: 'frame' },
    ], descendant)).toBe(false);
    expect(isSlidesAuthoringAncestorRefs([
      { slideKey: 'overview', editKey: 'card', targetKind: 'shape' },
    ], descendant)).toBe(false);
  });
});
