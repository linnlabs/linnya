import { describe, expect, it } from 'vitest';
import { parseSlidesManualEdits } from './manualEditsCodec';

describe('Slides manual edits codec', () => {
  it('接纳文本完整值与英寸累计位移', () => {
    expect(parseSlidesManualEdits({
      version: 1,
      slides: [{
        slideKey: 'overview',
        targets: [
          { kind: 'text', editKey: 'headline', content: '新的标题' },
          { kind: 'chart', editKey: 'revenue_chart', translation: { dx: 0.25, dy: -0.1 } },
        ],
      }],
    })).toEqual({
      value: {
        version: 2,
        slides: [{
          slideKey: 'overview',
          targets: [
            {
              kind: 'text',
              editKey: 'headline',
              content: '新的标题',
              translation: undefined,
            },
            { kind: 'chart', editKey: 'revenue_chart', translation: { dx: 0.25, dy: -0.1 } },
          ],
        }],
      },
    });
  });

  it('接纳 v2 样式、尺寸、原子删除和 Frame 子树删除', () => {
    expect(parseSlidesManualEdits({
      version: 2,
      slides: [{
        slideKey: 'overview',
        targets: [
          { kind: 'text', editKey: 'headline', fontSizePt: 28, color: '#123456' },
          { kind: 'shape', editKey: 'accent', fillColor: '#ABCDEF', visualSize: { width: 3, height: 1.5 } },
          { kind: 'image', editKey: 'hero', visualSize: { width: 4, height: 2 } },
          { kind: 'text', editKey: 'footnote', deleted: true },
          { kind: 'image', editKey: 'photo', deleted: true },
          { kind: 'frame', editKey: 'card', deleted: true },
        ],
      }],
    })).toEqual({
      value: {
        version: 2,
        slides: [{
          slideKey: 'overview',
          targets: [
            {
              kind: 'text', editKey: 'headline', fontSizePt: 28, color: '#123456',
              content: undefined, translation: undefined,
            },
            {
              kind: 'shape', editKey: 'accent', fillColor: '#ABCDEF',
              visualSize: { width: 3, height: 1.5 }, translation: undefined,
            },
            {
              kind: 'image', editKey: 'hero', visualSize: { width: 4, height: 2 },
              translation: undefined,
            },
            { kind: 'text', editKey: 'footnote', deleted: true },
            { kind: 'image', editKey: 'photo', deleted: true },
            { kind: 'frame', editKey: 'card', deleted: true },
          ],
        }],
      },
    });
  });

  it('拒绝越界样式、非正尺寸和带残留值的目标删除', () => {
    expect(parseSlidesManualEdits({
      version: 2,
      slides: [{ slideKey: 'overview', targets: [
        { kind: 'text', editKey: 'headline', fontSizePt: 0 },
      ] }],
    })).toEqual({ error: 'manualEdits.slides[0].targets[0].fontSizePt 必须是 1–400 pt 内的有限数字。' });

    expect(parseSlidesManualEdits({
      version: 2,
      slides: [{ slideKey: 'overview', targets: [
        { kind: 'image', editKey: 'hero', visualSize: { width: 0, height: 2 } },
      ] }],
    })).toEqual({ error: 'manualEdits.slides[0].targets[0].visualSize.width / height 必须是有限正数。' });

    expect(parseSlidesManualEdits({
      version: 2,
      slides: [{ slideKey: 'overview', targets: [
        { kind: 'shape', editKey: 'card', deleted: true, translation: { dx: 1, dy: 0 } },
      ] }],
    })).toEqual({ error: 'manualEdits.slides[0].targets[0] 删除目标时不能同时保留其他人工值。' });
  });

  it('拒绝重复目标、未知字段与空操作', () => {
    expect(parseSlidesManualEdits({
      version: 1,
      slides: [{
        slideKey: 'overview',
        targets: [
          { kind: 'text', editKey: 'headline', content: 'A' },
          { kind: 'text', editKey: 'headline', content: 'B' },
        ],
      }],
    })).toEqual({ error: 'manualEdits.slides[0].targets 中 editKey "headline" 重复。' });

    expect(parseSlidesManualEdits({
      version: 1,
      slides: [{
        slideKey: 'overview',
        targets: [{ kind: 'image', editKey: 'hero', translation: { dx: 1, dy: 2 }, opacity: 0.5 }],
      }],
    })).toEqual({ error: 'manualEdits.slides[0].targets[0] 含有 image 人工编辑不支持的字段。' });

    expect(parseSlidesManualEdits({
      version: 1,
      slides: [{ slideKey: 'overview', targets: [{ kind: 'text', editKey: 'headline' }] }],
    })).toEqual({ error: 'manualEdits.slides[0].targets[0] 至少需要 content 或 translation。' });
  });

  it('拒绝非有限位移与重复页面', () => {
    expect(parseSlidesManualEdits({
      version: 1,
      slides: [{
        slideKey: 'overview',
        targets: [{ kind: 'shape', editKey: 'line', translation: { dx: Number.NaN, dy: 0 } }],
      }],
    })).toEqual({ error: 'manualEdits.slides[0].targets[0].translation.dx / dy 必须是有限数字。' });

    expect(parseSlidesManualEdits({
      version: 1,
      slides: [
        { slideKey: 'overview', targets: [] },
        { slideKey: 'overview', targets: [] },
      ],
    })).toEqual({ error: 'manualEdits.slides 中 slideKey "overview" 重复。' });
  });
});
