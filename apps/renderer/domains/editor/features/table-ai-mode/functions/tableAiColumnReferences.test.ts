import { describe, expect, it } from 'vitest';
import type { TableAiModeContext } from '../definitions/tableAiMode';
import {
  buildClickedTableAiColumnReference,
  buildTableAiColumnReferencesFromKeys,
  parseTableAiColumnReferences,
  resolveTableAiColumnReferenceColor,
  type BuildTableAiColumnReferenceDependencies,
} from './tableAiColumnReferences';

const context: TableAiModeContext = {
  columnRefs: [
    { name: 'A', reference: 'A', range: 'A', rect: { top: 0, bottom: 2, left: 0, right: 1 } },
    { name: 'B', reference: 'B', range: 'B', rect: { top: 0, bottom: 2, left: 1, right: 2 } },
  ],
  selectionRange: 'A1:B2',
  outputColumnRange: 'C1:C2',
  activeColumnRefs: {},
  outputRect: { top: 0, bottom: 2, left: 2, right: 3 },
  outputColumnAdded: false,
};

function dependencies(): BuildTableAiColumnReferenceDependencies {
  let nextId = 0;
  return {
    parseRange: () => null,
    createId: () => `ref-${nextId += 1}`,
  };
}

describe('tableAiColumnReferences', () => {
  it('只为当前上下文中存在的引用建立状态', () => {
    const refs = buildTableAiColumnReferencesFromKeys(
      context,
      ['A', 'missing', 'B', 'A'],
      dependencies(),
    );

    expect(Object.keys(refs)).toEqual(['A', 'B']);
    expect(refs.A).toMatchObject({
      id: 'ref-1',
      rect: { top: 0, bottom: 2, left: 0, right: 1 },
      active: true,
    });
    expect(refs.B).toMatchObject({
      id: 'ref-2',
      rect: { top: 0, bottom: 2, left: 1, right: 2 },
      active: true,
    });
    expect(refs.A?.color).not.toBe(refs.B?.color);
  });

  it('点击引用时优先采用按当前坐标重新解析的矩形', () => {
    const resolved = buildClickedTableAiColumnReference(
      context,
      context.columnRefs[0],
      {
        ...dependencies(),
        parseRange: () => ({ top: 3, bottom: 5, left: 4, right: 5 }),
      },
    );

    expect(resolved?.rect).toEqual({ top: 3, bottom: 5, left: 4, right: 5 });
  });

  it('按当前表格列顺序稳定解析颜色，不依赖跨会话状态', () => {
    const firstPass = buildTableAiColumnReferencesFromKeys(context, ['B', 'A'], dependencies());
    const secondPass = buildTableAiColumnReferencesFromKeys(context, ['A', 'B'], dependencies());

    expect(firstPass.A?.color).toBe(secondPass.A?.color);
    expect(firstPass.B?.color).toBe(secondPass.B?.color);
    expect(firstPass.A?.color).not.toBe(firstPass.B?.color);
    expect(resolveTableAiColumnReferenceColor(context, 'missing')).toBeNull();
  });

  it('整体选区引用指向源列范围，而不是输出列', () => {
    const refs = buildTableAiColumnReferencesFromKeys(
      context,
      [context.selectionRange],
      dependencies(),
    );

    expect(refs[context.selectionRange]?.rect).toEqual({
      top: 0,
      bottom: 2,
      left: 0,
      right: 2,
    });
    expect(refs[context.selectionRange]?.rect).not.toEqual(context.outputRect);
  });

  it('从模板中按原位置解析列引用', () => {
    expect(parseTableAiColumnReferences('根据 {{A}} 和 {{B2:B4}} 生成，再参考 {{A}}'))
      .toEqual(['A', 'B2:B4', 'A']);
  });
});
