import { describe, expect, it } from 'vitest';
import { typecheckCodegenSource } from '../../../sandbox/codegenTypecheck/typecheckCodegenSource';
import {
  SlidesManualEditSourceError,
  writeManualEditsToDeckSource,
} from './writeManualEditsToDeckSource';

const BASE_SOURCE = `const slide = createSlide({ slideKey: "overview" });
const title = createText({ editKey: "headline", content: "Original" });
slide.add(title);

// This comment and the generated logic must stay untouched.
compose({
  title: "Demo",
  slides: [slide],
});
`;

describe('writeManualEditsToDeckSource', () => {
  it('向唯一 compose 对象插入规范人工值且保留其他源码', () => {
    const result = writeManualEditsToDeckSource(BASE_SOURCE, {
      op: 'set_text_content', targetKind: 'text',
      target: { slideKey: 'overview', editKey: 'headline' },
      content: 'Updated',
    });

    expect(result.manualEdits).toEqual({
      version: 2,
      slides: [{
        slideKey: 'overview',
        targets: [{ kind: 'text', editKey: 'headline', content: 'Updated' }],
      }],
    });
    expect(result.source).toContain('// This comment and the generated logic must stay untouched.');
    expect(result.source).toContain('  slides: [slide],\n  manualEdits: {');
    expect(typecheckCodegenSource(result.source).ok).toBe(true);
  });

  it('只替换已有 manualEdits initializer，并合并同一目标字段', () => {
    const withTranslation = writeManualEditsToDeckSource(BASE_SOURCE, {
      op: 'set_translation',
      target: { slideKey: 'overview', editKey: 'headline' },
      targetKind: 'text',
      translation: { dx: 0.2, dy: -0.1 },
    });
    const updated = writeManualEditsToDeckSource(withTranslation.source, {
      op: 'set_text_content', targetKind: 'text',
      target: { slideKey: 'overview', editKey: 'headline' },
      content: 'Final title',
    });

    expect(updated.manualEdits.slides[0].targets[0]).toEqual({
      kind: 'text',
      editKey: 'headline',
      content: 'Final title',
      translation: { dx: 0.2, dy: -0.1 },
    });
    expect(updated.source.match(/manualEdits:/gu)).toHaveLength(1);
    expect(updated.source.replace(/manualEdits:[\s\S]*?(?=\n\}\);)/u, 'manualEdits: <value>'))
      .toBe(BASE_SOURCE.replace('  slides: [slide],', '  slides: [slide],\n  manualEdits: <value>'));
  });

  it('形状内嵌改字与尺寸/颜色/位移合并，空字符串仍是有效内容', () => {
    const source = BASE_SOURCE.replace('createText', 'createShape');
    const target = { slideKey: 'overview', editKey: 'headline' };
    const filled = writeManualEditsToDeckSource(source, {
      op: 'set_fill_color', target, targetKind: 'shape', color: '#123456',
    });
    const moved = writeManualEditsToDeckSource(filled.source, {
      op: 'translate_by', target, targetKind: 'shape', delta: { dx: 1, dy: 2 },
    });
    const sized = writeManualEditsToDeckSource(moved.source, {
      op: 'set_visual_size', target, targetKind: 'shape', visualSize: { width: 3, height: 2 },
    });
    const edited = writeManualEditsToDeckSource(sized.source, {
      op: 'set_text_content', target, targetKind: 'shape', content: '',
    });
    expect(edited.manualEdits.slides[0].targets[0]).toEqual({
      kind: 'shape', editKey: 'headline', content: '', fillColor: '#123456',
      translation: { dx: 1, dy: 2 }, visualSize: { width: 3, height: 2 },
    });
    expect(typecheckCodegenSource(edited.source).ok).toBe(true);
    expect(() => writeManualEditsToDeckSource(edited.source, {
      op: 'set_text_content', target, targetKind: 'text', content: 'Wrong owner',
    })).toThrow('已记录为 shape');
  });

  it('拒绝动态人工值、重复 compose 和超限候选', () => {
    const dynamic = BASE_SOURCE.replace(
      '  slides: [slide],',
      '  slides: [slide],\n  manualEdits: buildManualEdits(),',
    );
    expect(() => writeManualEditsToDeckSource(dynamic, {
      op: 'set_text_content', targetKind: 'text',
      target: { slideKey: 'overview', editKey: 'headline' },
      content: 'Updated',
    })).toThrowError(SlidesManualEditSourceError);

    expect(() => writeManualEditsToDeckSource(
      `${BASE_SOURCE}\ncompose({ title: "Again", slides: [slide] });`,
      {
        op: 'set_text_content', targetKind: 'text',
        target: { slideKey: 'overview', editKey: 'headline' },
        content: 'Updated',
      },
    )).toThrow('只包含一个 compose');

    expect(() => writeManualEditsToDeckSource(BASE_SOURCE, {
      op: 'set_text_content', targetKind: 'text',
      target: { slideKey: 'overview', editKey: 'headline' },
      content: 'Updated',
    }, { maxSourceBytes: 10 })).toThrow('超过 10 bytes');
  });

  it('拒绝把已有目标改写为另一种作者类型', () => {
    const current = writeManualEditsToDeckSource(BASE_SOURCE, {
      op: 'set_text_content', targetKind: 'text',
      target: { slideKey: 'overview', editKey: 'headline' },
      content: 'Updated',
    });
    expect(() => writeManualEditsToDeckSource(current.source, {
      op: 'set_translation',
      target: { slideKey: 'overview', editKey: 'headline' },
      targetKind: 'chart',
      translation: { dx: 1, dy: 0 },
    })).toThrow('已记录为 text');
  });

  it('把连续 translate_by 累加到同一作者目标的当前位移', () => {
    const first = writeManualEditsToDeckSource(BASE_SOURCE, {
      op: 'translate_by',
      target: { slideKey: 'overview', editKey: 'headline' },
      targetKind: 'text',
      delta: { dx: 0.25, dy: -0.1 },
    });
    const second = writeManualEditsToDeckSource(first.source, {
      op: 'translate_by',
      target: { slideKey: 'overview', editKey: 'headline' },
      targetKind: 'text',
      delta: { dx: -0.05, dy: 0.3 },
    });

    expect(second.manualEdits.slides[0].targets[0]).toEqual({
      kind: 'text',
      editKey: 'headline',
      translation: { dx: 0.2, dy: 0.19999999999999998 },
    });
  });

  it('合并 v2 样式和尺寸时保留同一目标的其他人工值', () => {
    const moved = writeManualEditsToDeckSource(BASE_SOURCE, {
      op: 'set_translation',
      target: { slideKey: 'overview', editKey: 'headline' },
      targetKind: 'text',
      translation: { dx: 0.2, dy: -0.1 },
    });
    const sized = writeManualEditsToDeckSource(moved.source, {
      op: 'set_text_style',
      target: { slideKey: 'overview', editKey: 'headline' },
      fontSizePt: 28,
      color: '#123456',
    });
    const content = writeManualEditsToDeckSource(sized.source, {
      op: 'set_text_content', targetKind: 'text',
      target: { slideKey: 'overview', editKey: 'headline' },
      content: 'Final',
    });

    expect(content.manualEdits.slides[0].targets[0]).toEqual({
      kind: 'text',
      editKey: 'headline',
      translation: { dx: 0.2, dy: -0.1 },
      fontSizePt: 28,
      color: '#123456',
      content: 'Final',
    });
  });

  it('删除任意作者目标时清除过去人工值并保留目标类型', () => {
    const colored = writeManualEditsToDeckSource(BASE_SOURCE, {
      op: 'set_fill_color',
      target: { slideKey: 'overview', editKey: 'card' },
      targetKind: 'frame',
      color: '#ABCDEF',
    });
    const removed = writeManualEditsToDeckSource(colored.source, {
      op: 'delete_target',
      target: { slideKey: 'overview', editKey: 'card' },
      targetKind: 'frame',
    });

    expect(removed.manualEdits.slides[0].targets[0]).toEqual({
      kind: 'frame', editKey: 'card', deleted: true,
    });

    const text = writeManualEditsToDeckSource(BASE_SOURCE, {
      op: 'set_text_content', targetKind: 'text',
      target: { slideKey: 'overview', editKey: 'headline' },
      content: 'Temporary',
    });
    const removedText = writeManualEditsToDeckSource(text.source, {
      op: 'delete_target',
      target: { slideKey: 'overview', editKey: 'headline' },
      targetKind: 'text',
    });
    expect(removedText.manualEdits.slides[0].targets[0]).toEqual({
      kind: 'text', editKey: 'headline', deleted: true,
    });
    expect(() => writeManualEditsToDeckSource(removedText.source, {
      op: 'set_text_style',
      target: { slideKey: 'overview', editKey: 'headline' },
      color: '#123456',
    })).toThrow('已删除');
  });
});
