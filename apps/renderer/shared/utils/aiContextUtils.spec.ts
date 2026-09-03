/**
 * @file aiContextUtils.spec.ts
 * @description aiContextUtils 基础单元测试（烟囱测试）
 *
 * 目标：
 * - 覆盖几个关键入口的「空 editor / 异常参数」行为，确保不会抛异常
 * - 为后续引入更完整的 Editor / DOM mock 打基础
 */

import { describe, it, expect } from 'vitest';

// 直接从同目录导入 JS 工具模块
// 注意：被测文件是 JS，这里作为普通模块引入即可
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error JS 模块导入
import {
  getContextAroundSelection,
  getDefaultBlockContext,
  getAnnotationContext,
  getViewportContext,
  getViewportDocumentView,
  getAutocompleteContext
} from './aiContextUtils.js';

describe('aiContextUtils（基础行为）', () => {
  it('getContextAroundSelection: editor 无效时应返回 null 上下文', () => {
    // @ts-expect-error 故意传入 null，测试防御性逻辑
    const result = getContextAroundSelection(null, {});
    expect(result).toEqual({ contextBefore: null, contextAfter: null });
  });

  it('getDefaultBlockContext: editor 无效时应返回 null 上下文', () => {
    // @ts-expect-error 故意传入 null，测试防御性逻辑
    const result = getDefaultBlockContext(null, { blocksBefore: 1, blocksAfter: 1 });
    expect(result).toEqual({ contextBefore: null, contextAfter: null });
  });

  it('getAnnotationContext: blockId 为空时应返回 null', () => {
    // @ts-expect-error 故意传入 null，测试防御性逻辑
    const result = getAnnotationContext(null, '', { blocksBefore: 1, blocksAfter: 1 });
    expect(result).toBeNull();
  });

  it('getViewportContext: editor 或 view 无效时应回退为默认块上下文', () => {
    // 这里构造一个最小的「伪 editor」对象，仅包含 state/view 为空的情况
    const fakeEditor: any = { view: null, state: null };
    const result = getViewportContext(fakeEditor, {
      blocksBefore: 1,
      blocksAfter: 1,
      includeCurrentBlock: true
    });
    // 当 editor/view 无效时，函数内部会回退到 getDefaultBlockContext，
    // 而 getDefaultBlockContext 在 editor.state 无效时会返回 null 上下文
    expect(result).toEqual({ contextBefore: null, contextAfter: null });
  });

  it('getViewportDocumentView: editor 无效时应返回 null', () => {
    // @ts-expect-error 故意传入 null，测试防御性逻辑
    return getViewportDocumentView(null, {}, { documentId: 'test-doc', maxChars: 1000 }).then((result: any) => {
      expect(result).toBeNull();
    });
  });

  it('getAutocompleteContext: selection 非空或 editor 无效时应返回 null 上下文', () => {
    // @ts-expect-error 故意传入 null，测试防御性逻辑
    const result = getAutocompleteContext(null, {
      blocksBefore: 2,
      blocksAfter: 2,
      charsLimitBefore: 100,
      charsLimitAfter: 100
    });
    expect(result).toEqual({ contextBefore: null, contextAfter: null });
  });

  it('getDefaultBlockContext: 未传 options 时应抛出明确错误', () => {
    const fakeEditor: any = {};
    // @ts-expect-error 故意不传 options，验证错误分支
    expect(() => getDefaultBlockContext(fakeEditor)).toThrowError(
      '[aiContextUtils] getDefaultBlockContext 需要传入配置选项，请使用各功能模块的配置文件'
    );
  });

  it('getAnnotationContext: 未传 options 时应抛出明确错误', () => {
    const fakeEditor: any = {};
    // @ts-expect-error 故意不传 options，验证错误分支
    expect(() => getAnnotationContext(fakeEditor, 'block-id-1')).toThrowError(
      '[aiContextUtils] getAnnotationContext 需要传入配置选项，请使用 Annotation/config/contextConfig.ts'
    );
  });

  it('getAutocompleteContext: 未传 options 时应抛出明确错误', () => {
    const fakeEditor: any = { state: {} };
    // @ts-expect-error 故意不传 options，验证错误分支
    expect(() => getAutocompleteContext(fakeEditor)).toThrowError(
      '[aiContextUtils] getAutocompleteContext 需要传入配置选项，请使用 AutoComplete/config/contextConfig.ts'
    );
  });
});

