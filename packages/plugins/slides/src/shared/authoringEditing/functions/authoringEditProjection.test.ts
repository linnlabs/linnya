import { describe, expect, it } from 'vitest';
import { isSlidesAuthoringEditProjection } from './authoringEditProjection';

describe('authoring edit projection', () => {
  it('accepts explicit plain text authoring facts independently of render runs', () => {
    expect(isSlidesAuthoringEditProjection({
      capabilities: ['translate', 'set_text_content', 'set_text_style'],
      text: {
        kind: 'plain_text', content: '增长 2026\n下一行', fontSizePt: 24, color: '#123456',
      },
    })).toBe(true);
  });

  it('keeps text without an editable author value read-only and rejects inconsistent capabilities', () => {
    expect(isSlidesAuthoringEditProjection({
      capabilities: ['translate'],
      text: { kind: 'rich_text' },
    })).toBe(true);
    expect(isSlidesAuthoringEditProjection({
      capabilities: ['translate', 'set_text_content', 'set_text_style'],
      text: { kind: 'rich_text' },
    })).toBe(false);
  });

  it('accepts original text runs and rejects formula or unknown style fields', () => {
    const projection = { capabilities: ['translate', 'set_text_content', 'set_text_style'], text: { kind: 'rich_text',
      content: [{ text: 'A', style: { color: '#112233', bold: true } }, { text: 'B' }] } };
    expect(isSlidesAuthoringEditProjection(projection)).toBe(true);
    expect(isSlidesAuthoringEditProjection({ ...projection, text: { kind: 'rich_text', content: [{ formula: 'x' }] } })).toBe(false);
    expect(isSlidesAuthoringEditProjection({ ...projection, text: { kind: 'rich_text', content: [{ text: 'A', style: { paint: 'red' } }] } })).toBe(false);
  });

  it('accepts the element writing mode in the generated base style', () => {
    const projection = (writingMode: unknown) => ({
      capabilities: ['translate', 'set_text_content', 'set_text_style'],
      text: { kind: 'rich_text', content: [{ text: '茶' }], baseStyle: { fontFamily: 'KaiTi', writingMode } },
    });
    // 生成稿映射总会写出 writingMode 键；横排时它的值是 undefined。
    expect(isSlidesAuthoringEditProjection(projection(undefined))).toBe(true);
    expect(isSlidesAuthoringEditProjection(projection('vertical-rl'))).toBe(true);
    expect(isSlidesAuthoringEditProjection(projection('vertical-lr'))).toBe(false);
  });

  it('accepts frame translation as an explicit authoring capability', () => {
    expect(isSlidesAuthoringEditProjection({
      capabilities: ['translate', 'set_fill_color', 'delete'],
      fill: { kind: 'solid', color: '#EEEEEE' },
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
