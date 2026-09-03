import { describe, expect, it } from 'vitest';

import { planOutlineListUpdate } from './outlineUpdatePolicy';

describe('planOutlineListUpdate', () => {
  it('只在目录打开时填充标题列表', () => {
    expect(
      planOutlineListUpdate({
        hasAnyHeadings: true,
        outlineVisible: false,
        currentListLength: 0,
      })
    ).toEqual({
      publishHasHeadings: true,
      shouldPopulateList: false,
      shouldClearList: false,
    });
  });

  it('目录关闭且已有旧列表时清空列表，避免隐藏目录继续参与大文档响应式更新', () => {
    expect(
      planOutlineListUpdate({
        hasAnyHeadings: true,
        outlineVisible: false,
        currentListLength: 12,
      })
    ).toEqual({
      publishHasHeadings: true,
      shouldPopulateList: false,
      shouldClearList: true,
    });
  });

  it('目录打开且存在标题时允许构建完整列表', () => {
    expect(
      planOutlineListUpdate({
        hasAnyHeadings: true,
        outlineVisible: true,
        currentListLength: 0,
      })
    ).toEqual({
      publishHasHeadings: true,
      shouldPopulateList: true,
      shouldClearList: false,
    });
  });

  it('没有标题时发布 false 并清理旧列表', () => {
    expect(
      planOutlineListUpdate({
        hasAnyHeadings: false,
        outlineVisible: true,
        currentListLength: 3,
      })
    ).toEqual({
      publishHasHeadings: false,
      shouldPopulateList: false,
      shouldClearList: true,
    });
  });
});
