import { describe, expect, it } from 'vitest';
import { SlideMarkerIndex } from '@plugin/slides/shared';
import { typecheckCodegenSource } from '../../../sandbox/codegenTypecheck/typecheckCodegenSource.js';
import { rewriteSlideStructureInDeckSource } from './rewriteSlideStructureInDeckSource.js';

const source = `const first = createSlide({ slideKey: 'first' });
const title = createText({ editKey: 'title', content: 'First' });
first.add(title);

// Second page
const second = createSlide({ slideKey: 'second' });
second.add(createText('Second'));
compose({ title: 'Demo', slides: [first, second], manualEdits: {
  version: 2, slides: [{ slideKey: 'first', targets: [{ kind: 'text', editKey: 'title', content: 'Edited' }] }]
} });`;

describe('page source lifecycle', () => {
  it('copies page-local declarations in an independent scope and copies manual values', () => {
    const copy = rewriteSlideStructureInDeckSource(source, { op: 'duplicate_slide', index: 0, slideCount: 2 });
    expect(typecheckCodegenSource(copy).ok).toBe(true);
    expect(copy).toContain('slides: [first, copiedSlide1, second]');
    expect(copy).toContain('"slideKey": "copied-slide-1"');
    expect(SlideMarkerIndex.build(copy).listSlides()).toHaveLength(3);
    const deleted = rewriteSlideStructureInDeckSource(copy, { op: 'delete_slide', index: 0, slideCount: 3 });
    expect(typecheckCodegenSource(deleted).ok).toBe(true);
    expect(deleted).not.toContain('"slideKey": "first"');
    expect(deleted).toContain('// Second page');
    expect(deleted).toContain('const title = createText');
    const copiedAgain = rewriteSlideStructureInDeckSource(deleted, { op: 'duplicate_slide', index: 0, slideCount: 2 });
    expect(typecheckCodegenSource(copiedAgain).ok).toBe(true);
    expect(copiedAgain).toContain('slides: [copiedSlide1, copiedSlide2, second]');
  });

  it('supports named lists, reordered pages, and retains at least one page', () => {
    const named = source.replace("compose({ title: 'Demo', slides: [first, second],", "const pages = [first, second];\ncompose({ title: 'Demo', slides: pages,");
    expect(typecheckCodegenSource(rewriteSlideStructureInDeckSource(named, { op: 'duplicate_slide', index: 1, slideCount: 2 })).ok).toBe(true);
    expect(() => rewriteSlideStructureInDeckSource('const a = createSlide();\ncompose({title:"X",slides:[a]});', { op: 'delete_slide', index: 0, slideCount: 1 })).toThrow('至少需要保留');
    const reordered = source.replace('slides: [first, second]', 'slides: [second, first]');
    expect(SlideMarkerIndex.build(reordered).sliceSlide(1)).toContain('const second');
    const deleted = rewriteSlideStructureInDeckSource(reordered, { op: 'delete_slide', index: 0, slideCount: 2 });
    expect(deleted).toContain('slides: [first]');
    expect(deleted).not.toContain('const second');
    expect(typecheckCodegenSource(deleted).ok).toBe(true);
  });
  it('rejects dynamic slide identities instead of silently dropping manual values from a copy', () => {
    expect(() => rewriteSlideStructureInDeckSource(source.replace("slideKey: 'first'", "slideKey: ['first'].join('')"), { op: 'duplicate_slide', index: 0, slideCount: 2 })).toThrow('slideKey');
    expect(() => rewriteSlideStructureInDeckSource(source.replace("{ slideKey: 'first' }", "{ ...{ slideKey: 'first' } }"), { op: 'duplicate_slide', index: 0, slideCount: 2 })).toThrow('动态字段');
  });

});
