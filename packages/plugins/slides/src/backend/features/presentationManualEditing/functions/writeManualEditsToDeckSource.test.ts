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
      op: 'set_text_content',
      target: { slideKey: 'overview', editKey: 'headline' },
      content: 'Updated',
    });

    expect(result.manualEdits).toEqual({
      version: 1,
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
      op: 'set_text_content',
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

  it('拒绝动态人工值、重复 compose 和超限候选', () => {
    const dynamic = BASE_SOURCE.replace(
      '  slides: [slide],',
      '  slides: [slide],\n  manualEdits: buildManualEdits(),',
    );
    expect(() => writeManualEditsToDeckSource(dynamic, {
      op: 'set_text_content',
      target: { slideKey: 'overview', editKey: 'headline' },
      content: 'Updated',
    })).toThrowError(SlidesManualEditSourceError);

    expect(() => writeManualEditsToDeckSource(
      `${BASE_SOURCE}\ncompose({ title: "Again", slides: [slide] });`,
      {
        op: 'set_text_content',
        target: { slideKey: 'overview', editKey: 'headline' },
        content: 'Updated',
      },
    )).toThrow('只包含一个 compose');

    expect(() => writeManualEditsToDeckSource(BASE_SOURCE, {
      op: 'set_text_content',
      target: { slideKey: 'overview', editKey: 'headline' },
      content: 'Updated',
    }, { maxSourceBytes: 10 })).toThrow('超过 10 bytes');
  });

  it('拒绝把已有目标改写为另一种作者类型', () => {
    const current = writeManualEditsToDeckSource(BASE_SOURCE, {
      op: 'set_text_content',
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
});
